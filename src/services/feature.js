// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const QRCode = require("qrcode");
const { ethers } = require("ethers"); // Ethereum JavaScript library

// Import custom cryptoFunction module for encryption and decryption
const { generateEncryptedUrl } = require("../common/cryptoFunction");

// Import MongoDB models
const { User, Issues, BatchIssues, ShortUrl, DynamicIssues, DynamicBatchIssues } = require("../config/schema");

// Import ABI (Application Binary Interface) from the JSON file located at "../config/abi.json"
const abi = require("../config/abi.json");

// Importing functions from a custom module
const {
    isValidIssuer,
    connectToPolygon,
    connectToStandby,
    connectToPolygonIssue,
    connectToStandbyIssue,
    convertDateFormat,
    convertDateToEpoch,
    insertIssueStatus,
    insertDynamicIssueStatus,
    convertEpochToDate, // Function to insert certificate data into the database
    getCertificationStatus,
    calculateHash, // Function to calculate the hash of a file
    isDBConnected, // Function to check if the database connection is established
    holdExecution
} = require('../model/tasks'); // Importing functions from the '../model/tasks' module

const { fetchOrEstimateTransactionFee } = require('../utils/upload');

// Retrieve contract address from environment variable
const contractAddress = process.env.CONTRACT_ADDRESS;

// Define an array of providers to use as fallbacks
const providers = [
    new ethers.AlchemyProvider(process.env.RPC_NETWORK, process.env.ALCHEMY_API_KEY),
    new ethers.InfuraProvider(process.env.RPC_NETWORK, process.env.INFURA_API_KEY)
    // Add more providers as needed
];

// Create a new FallbackProvider instance
const fallbackProvider = new ethers.FallbackProvider(providers);

// Create a new ethers signer instance using the private key from environment variable and the provider(Fallback)
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, fallbackProvider);

// Create a new ethers contract instance with a signing capability (using the contract Address, ABI and signer)
const newContract = new ethers.Contract(contractAddress, abi, signer);

// Parse environment variables for password length constraints
const min_length = parseInt(process.env.MIN_LENGTH);
const max_length = parseInt(process.env.MAX_LENGTH);

const messageCode = require("../common/codes");

const handleRenewCertification = async (email, certificateNumber, _expirationDate) => {
    // const newContract = await connectToPolygon();
    // if (!newContract) {
    //     return ({ code: 400, status: "FAILED", message: messageCode.msgRpcFailed });
    // }
    const expirationDate = _expirationDate != 1 ? await convertDateFormat(_expirationDate) : 1;
    // Get today's date
    let today = new Date().toLocaleString("en-US", { timeZone: "America/New_York" }); // Adjust timeZone as per the US Standard Time zone
    // Convert today's date to epoch time (in milliseconds)
    let todayEpoch = new Date(today).getTime() / 1000; // Convert milliseconds to seconds

    let epochExpiration = _expirationDate != 1 ? await convertDateToEpoch(expirationDate) : 1;
    let validExpiration = todayEpoch + (32 * 24 * 60 * 60); // Add 32 days (30 * 24 hours * 60 minutes * 60 seconds);

    try {
        await isDBConnected();
        // Check if user with provided email exists
        const idExist = await isValidIssuer(email);
        // Check if certificate number already exists
        const isNumberExist = await Issues.findOne({ certificateNumber: certificateNumber });
        // Check if certificate number already exists in the Batch
        const isNumberExistInBatch = await BatchIssues.findOne({ certificateNumber: certificateNumber });

        // Validation checks for request data
        if (
            (!idExist || idExist.status !== 1) || // User does not exist
            !certificateNumber || // Missing certificate number
            (!expirationDate || expirationDate == 'Invalid date') ||
            (epochExpiration != 1 && epochExpiration < validExpiration)
        ) {
            // Prepare error message
            let errorMessage = messageCode.msgPlsEnterValid;
            // Check for specific error conditions and update the error message accordingly
            if (!expirationDate || expirationDate == 'Invalid date') {
                errorMessage = messageCode.msgProvideValidDates;
            } else if (!certificateNumber) {
                errorMessage = messageCode.msgCertIdRequired;
            } else if (!idExist) {
                errorMessage = messageCode.msgInvalidIssuer;
            } else if (idExist.status !== 1) {
                errorMessage = messageCode.msgUnauthIssuer;
            }
            else if (epochExpiration != 1 && epochExpiration < validExpiration) {
                errorMessage = `${expirationDate} - ${messageCode.msgInvalidNewExpiration}`;
            }
            // Respond with error message
            return ({ code: 400, status: "FAILED", message: errorMessage });
        }

        const blockchainPreference = (!idExist.blockchainPreference || idExist.blockchainPreference == 0) ? 0 : 1;

        if (isNumberExist) {
            if (isNumberExist.expirationDate == "1") {
                return ({ code: 400, status: "FAILED", message: messageCode.msgUpdateExpirationNotPossible });
            }

            epochExpiration = expirationDate != 1 ? await convertDateToEpoch(expirationDate) : 1;
            if (expirationDate != 1 && epochExpiration < todayEpoch) {
                return ({ code: 400, status: "FAILED", message: messageCode.msgCertExpired });
            }

            var newContract;
            var blockchainOption = (!isNumberExist.blockchainOption || isNumberExist.blockchainOption == 0) ? 0 : 1;

            if (blockchainPreference != blockchainOption) {
                if (blockchainPreference == 0) {
                    return { code: 400, status: "FAILED", message: messageCode.msgSetChainToStandby };
                } else {
                    return { code: 400, status: "FAILED", message: messageCode.msgSetChainToPolygon };
                }
            }

            if (blockchainOption == 0) {
                newContract = await connectToPolygon();
                if (!newContract) {
                    return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                }
            } else {
                newContract = await connectToStandby();
                if (!newContract) {
                    return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                }
            }

            // Blockchain calls
            const getCertificateStatus = await newContract.getCertificateStatus(certificateNumber);

            try {

                let certStatus = parseInt(getCertificateStatus);
                if (certStatus == 3) {
                    // Respond with error message
                    return ({ code: 400, status: "FAILED", message: messageCode.msgNotPossibleOnRevoked });
                }

                if (expirationDate != 1) {
                    let certDateValidation = await expirationDateVariaton(isNumberExist.expirationDate, expirationDate);

                    if (certDateValidation == 0 || certDateValidation == 2) {
                        // Respond with error message
                        return ({ code: 400, status: "FAILED", message: `${messageCode.msgEpirationMustGreater}: ${isNumberExist.expirationDate}` });
                    }
                }

                // Prepare fields for the certificate
                const fields = {
                    Certificate_Number: certificateNumber,
                    name: isNumberExist.name,
                    courseName: isNumberExist.course,
                    Grant_Date: isNumberExist.grantDate,
                    Expiration_Date: expirationDate != 1 ? expirationDate : "1",
                };
                // Hash sensitive fields
                const hashedFields = {};
                for (const field in fields) {
                    hashedFields[field] = calculateHash(fields[field]);
                }
                const combinedHash = calculateHash(JSON.stringify(hashedFields));

                try {
                    // Verify on blockchain
                    const isPaused = await newContract.paused();
                    const issuerAuthorized = await newContract.hasRole(process.env.ISSUER_ROLE, idExist.issuerId);
                    const verifyOnChain = await newContract.verifyCertificateById(certificateNumber);
                    const certExpiration = parseInt(verifyOnChain[1]);
                    if (certExpiration == 1) {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgUpdateExpirationNotPossible });
                    }
                    if (
                        issuerAuthorized === false ||
                        isPaused === true
                    ) {
                        let messageContent = "";
                        // Issuer not authorized / contract paused
                        if (isPaused === true) {
                            messageContent = messageCode.msgOpsRestricted;
                        } else if (issuerAuthorized === false) {
                            messageContent = messageCode.msgIssuerUnauthrized;
                        }
                        return ({ code: 400, status: "FAILED", message: messageContent });
                    }

                    if (verifyOnChain[0] === true) {

                        var { txHash, txFee } = await renewSingleCertificateExpirationWithRetry(blockchainOption, certificateNumber, combinedHash, epochExpiration);
                        if (!txHash) {
                            return ({ code: 400, status: false, message: messageCode.msgFailedToRenewRetry, details: epochExpiration });
                        }

                        var polygonLink;
                        if (blockchainOption == 0) {
                            polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;
                        } else {
                            polygonLink = `https://${process.env.STANDBY_NETWORK}/tx/${txHash}`;
                        }

                        // Generate encrypted URL with certificate data
                        const dataWithLink = { ...fields, polygonLink: polygonLink }
                        const urlLink = generateEncryptedUrl(dataWithLink);
                        let shortUrlStatus;
                        let modifiedUrl;

                        // Generate QR code based on the URL
                        const legacyQR = false;
                        let qrCodeData = '';
                        if (legacyQR) {
                            // Include additional data in QR code
                            qrCodeData = `Verify On Blockchain: ${polygonLink},
                Certification Number: ${certificateNumber},
                Name: ${fields.name},
                Certification Name: ${fields.courseName},
                Grant Date: ${fields.Grant_Date},
                Expiration Date: ${expirationDate}`;
                        } else {
                            // Directly include the URL in QR code
                            qrCodeData = urlLink;
                        }

                        modifiedUrl = process.env.SHORT_URL + certificateNumber;

                        const _qrCodeData = modifiedUrl != false ? modifiedUrl : qrCodeData;

                        var qrCodeImage = await QRCode.toDataURL(_qrCodeData, {
                            errorCorrectionLevel: "H",
                            width: 450, // Adjust the width as needed
                            height: 450, // Adjust the height as needed
                        });

                    } else {
                        // Respond with error message
                        return ({ code: 400, status: "FAILED", message: messageCode.msgCertBadRenewStatus });
                    }

                    try {
                        // Check mongoose connection
                        const dbStatus = await isDBConnected();
                        const dbStatusMessage = (dbStatus == true) ? messageCode.msgDbReady : messageCode.msgDbNotReady;
                        console.log(dbStatusMessage);

                        // Save Issue details (modified)
                        isNumberExist.certificateHash = combinedHash;
                        isNumberExist.expirationDate = expirationDate;
                        isNumberExist.transactionHash = txHash;
                        isNumberExist.certificateStatus = 2;
                        isNumberExist.issueDate = Date.now();

                        // Save certification data into database
                        await isNumberExist.save();

                        // Update certificate Count
                        let previousCount = idExist.certificatesIssued;
                        idExist.certificatesIssued = previousCount + 1;
                        // If user with given id exists, update certificatesRenewed count
                        let previousRenewCount = idExist.certificatesRenewed || 0; // Initialize to 0 if certificatesIssued field doesn't exist
                        idExist.certificatesRenewed = previousRenewCount + 1;
                        // If user with given id exists, update certificatesIssued transation fee
                        const previousrtransactionFee = idExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                        idExist.transactionFee = previousrtransactionFee + txFee;

                        await idExist.save(); // Save the changes to the existing user

                        const issuerId = idExist.issuerId;

                        var certificateData = {
                            issuerId,
                            transactionHash: txHash,
                            certificateHash: combinedHash,
                            certificateNumber: certificateNumber,
                            course: isNumberExist.course,
                            name: isNumberExist.name,
                            expirationDate: expirationDate,
                            type: isNumberExist.type,
                            email: email,
                            certStatus: 2,
                            blockchainOption: blockchainPreference
                        };
                        // Insert certification status data into database
                        await insertIssueStatus(certificateData);

                    } catch (error) {
                        // Handle mongoose connection error (log it, response an error, etc.)
                        console.error(messageCode.msgInternalError, error);
                        return ({ code: 500, status: "FAILED", message: messageCode.msgInternalError, details: error });
                    }

                    // Respond with success message and certificate details
                    return ({
                        code: 200,
                        status: "SUCCESS",
                        message: messageCode.msgCertRenewedSuccess,
                        qrCodeImage: qrCodeImage,
                        polygonLink: polygonLink,
                        type: certificateData.type,
                        details: certificateData,
                    });

                } catch (error) {
                    // Internal server error
                    console.error(error);
                    return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
                }
            } catch (error) {
                // Internal server error
                console.error(error);
                return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
            }

        } else if (isNumberExistInBatch) {
            if (isNumberExistInBatch.expirationDate == "1") {
                return ({ code: 400, status: "FAILED", message: messageCode.msgUpdateExpirationNotPossible });
            }
            var newContract;
            var blockchainOption = (!isNumberExistInBatch.blockchainOption || isNumberExistInBatch.blockchainOption == 0) ? 0 : 1;

            if (blockchainPreference != blockchainOption) {
                if (blockchainPreference == 0) {
                    return { code: 400, status: "FAILED", message: messageCode.msgSetChainToStandby };
                } else {
                    return { code: 400, status: "FAILED", message: messageCode.msgSetChainToPolygon };
                }
            }

            if (blockchainOption == 0) {
                newContract = await connectToPolygon();
                if (!newContract) {
                    return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                }
            } else {
                newContract = await connectToStandby();
                if (!newContract) {
                    return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                }
            }

            try {
                //blockchain calls
                let fetchIndex = isNumberExistInBatch.batchId - 1;
                // let verifyBatchId = await newContract.verifyBatchRoot(fetchIndex);
                // let _fetchRootLength = await newContract.getRootLength();
                // let fetchRootLength = parseInt(_fetchRootLength);
                let hashedProof = isNumberExistInBatch.encodedProof;
                let certificateStatus = await newContract.getBatchCertificateStatus(hashedProof);
                // if (fetchRootLength < fetchIndex) {
                //     // Respond with error message
                //     return ({ code: 400, status: "FAILED", message: messageCode.msgInvalidRootPassed });
                // } else {
                const batchStatus = isNumberExistInBatch.certificateStatus;
                if (batchStatus == 3 || (parseInt(certificateStatus) == 3)) {
                    // Respond with error message
                    return ({ code: 400, status: "FAILED", message: messageCode.msgNotPossibleOnRevoked });
                }

                if (expirationDate != 1) {
                    const certDateValidation = await expirationDateVariaton(isNumberExistInBatch.expirationDate, expirationDate);

                    if (certDateValidation == 0 || certDateValidation == 2) {
                        // Respond with error message
                        return ({ code: 400, status: "FAILED", message: `${messageCode.msgEpirationMustGreater}: ${isNumberExistInBatch.expirationDate}` });
                    }
                }

                var newContract;
                var blockchainOption = (!isNumberExistInBatch.blockchainOption || isNumberExistInBatch.blockchainOption == 0) ? 0 : 1;

                if (blockchainPreference != blockchainOption) {
                    if (blockchainPreference == 0) {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToStandby };
                    } else {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToPolygon };
                    }
                }

                if (blockchainOption == 0) {
                    newContract = await connectToPolygon();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                } else {
                    newContract = await connectToStandby();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                }

                try {
                    // Verify certificate on blockchain
                    const isPaused = await newContract.paused();
                    const issuerAuthorized = await newContract.hasRole(process.env.ISSUER_ROLE, idExist.issuerId);
                    let messageContent = "";

                    if (
                        issuerAuthorized === false ||
                        isPaused === true
                    ) {
                        // Issuer not authorized / contract paused
                        if (isPaused === true) {
                            messageContent = messageCode.msgOpsRestricted;
                        } else if (issuerAuthorized === false) {
                            messageContent = messageCode.msgIssuerUnauthrized;
                        }
                        return ({ code: 400, status: "FAILED", message: messageContent });
                    }

                    // Prepare fields for the certificate
                    const fields = {
                        Certificate_Number: certificateNumber,
                        name: isNumberExistInBatch.name,
                        courseName: isNumberExistInBatch.course,
                        Grant_Date: isNumberExistInBatch.grantDate,
                        Expiration_Date: expirationDate != 1 ? expirationDate : "1",
                    };
                    // Hash sensitive fields
                    const hashedFields = {};
                    for (const field in fields) {
                        hashedFields[field] = calculateHash(fields[field]);
                    }
                    const combinedHash = calculateHash(JSON.stringify(hashedFields));

                    try {
                        // Verify certificate on blockchain
                        const isPaused = await newContract.paused();
                        const issuerAuthorized = await newContract.hasRole(process.env.ISSUER_ROLE, idExist.issuerId);
                        const verifyOnChain = await newContract.verifyCertificateById(certificateNumber);
                        let messageContent = "";

                        if (
                            issuerAuthorized === false ||
                            isPaused === true
                        ) {
                            // Issuer not authorized / contract paused
                            if (isPaused === true) {
                                messageContent = messageCode.msgOpsRestricted;
                            } else if (issuerAuthorized === false) {
                                messageContent = messageCode.msgIssuerUnauthrized;
                            }
                            return ({ code: 400, status: "FAILED", message: messageContent });
                        }

                        if (verifyOnChain[0] === false) {

                            var { txHash, txFee } = await renewCertificateExpirationInBatchWithRetry(blockchainOption, fetchIndex, hashedProof, epochExpiration);
                            if (!txHash) {
                                return ({ code: 400, status: false, message: messageCode.msgFailedToRenewRetry, details: epochExpiration });
                            }

                            var polygonLink;
                            if (blockchainOption == 0) {
                                polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;
                            } else {
                                polygonLink = `https://${process.env.STANDBY_NETWORK}/tx/${txHash}`;
                            }

                            // Generate encrypted URL with certificate data

                            const dataWithLink = { ...fields, polygonLink: polygonLink }
                            const urlLink = generateEncryptedUrl(dataWithLink);
                            let shortUrlStatus;
                            let modifiedUrl;

                            // Generate QR code based on the URL
                            const legacyQR = false;
                            let qrCodeData = '';
                            if (legacyQR) {
                                // Include additional data in QR code
                                qrCodeData = `Verify On Blockchain: ${polygonLink},
                                        Certification Number: ${certificateNumber},
                                        Name: ${fields.name},
                                        Certification Name: ${fields.courseName},
                                        Grant Date: ${fields.Grant_Date},
                                        Expiration Date: ${fields.Expiration_Date}`;
                            } else {
                                // Directly include the URL in QR code
                                qrCodeData = urlLink;
                            }

                            modifiedUrl = process.env.SHORT_URL + certificateNumber;

                            const _qrCodeData = modifiedUrl != false ? modifiedUrl : qrCodeData;

                            var qrCodeImage = await QRCode.toDataURL(_qrCodeData, {
                                errorCorrectionLevel: "H",
                                width: 450, // Adjust the width as needed
                                height: 450, // Adjust the height as needed
                            });

                        } else {
                            // Respond with error message
                            return ({ code: 400, status: "FAILED", message: messageCode.msgCertBadRenewStatus });
                        }

                        try {
                            // Check mongoose connection
                            const dbStatus = await isDBConnected();
                            const dbStatusMessage = (dbStatus == true) ? messageCode.msgDbReady : messageCode.msgDbNotReady;
                            console.log(dbStatusMessage);

                            // Save Issue details (modified)
                            isNumberExistInBatch.transactionHash = txHash;
                            isNumberExistInBatch.expirationDate = fields.Expiration_Date;
                            isNumberExistInBatch.certificateStatus = 2;
                            isNumberExistInBatch.issueDate = Date.now();

                            // Save certification data into database
                            await isNumberExistInBatch.save();

                            // Update certificate Count
                            let previousCount = idExist.certificatesIssued;
                            idExist.certificatesIssued = previousCount + 1;

                            // If user with given id exists, update certificatesRenewed count
                            let previousRenewCount = idExist.certificatesRenewed || 0; // Initialize to 0 if certificatesIssued field doesn't exist
                            idExist.certificatesRenewed = previousRenewCount + 1;
                            // If user with given id exists, update certificatesIssued transation fee
                            const previousrtransactionFee = idExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                            idExist.transactionFee = previousrtransactionFee + txFee;

                            await idExist.save(); // Save the changes to the existing user

                            const issuerId = idExist.issuerId;

                            var certificateData = {
                                issuerId,
                                batchId: isNumberExistInBatch.batchId,
                                transactionHash: txHash,
                                certificateHash: combinedHash,
                                certificateNumber: certificateNumber,
                                course: isNumberExistInBatch.course,
                                name: isNumberExistInBatch.name,
                                expirationDate: fields.Expiration_Date,
                                email: email,
                                certStatus: 2,
                                blockchainOption: blockchainPreference
                            };
                            // Insert certification status data into database
                            await insertIssueStatus(certificateData);

                        } catch (error) {
                            // Handle mongoose connection error (log it, response an error, etc.)
                            console.error(messageCode.msgIssueWithDB, error);
                            return ({ code: 500, status: "FAILED", message: messageCode.msgIssueWithDB, details: error });
                        }

                        // Respond with success message and certificate details
                        return ({
                            code: 200,
                            status: "SUCCESS",
                            certType: "batch",
                            message: messageCode.msgCertRenewedSuccess,
                            qrCodeImage: qrCodeImage,
                            polygonLink: polygonLink,
                            details: isNumberExistInBatch,
                        });

                    } catch (error) {
                        // Internal server error
                        console.error(error);
                        return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
                    }

                } catch (error) {
                    // Internal server error
                    console.error(error);
                    return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
                }
                // }
            } catch (error) {
                // Internal server error
                console.error(error);
                return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
            }

        } else {
            // Respond with error message
            return ({ code: 400, status: "FAILED", message: messageCode.msgCertNotExist });
        }

    } catch (error) {
        // Internal server error
        console.error(error);
        return ({ code: 400, status: "FAILED", message: messageCode.msgInternalError, details: error });
    }
};

const handleUpdateCertificationStatus = async (email, certificateNumber, certStatus) => {
    // const newContract = await connectToPolygon();
    // if (!newContract) {
    //     return ({ code: 400, status: "FAILED", message: messageCode.msgRpcFailed });
    // }
    // Get today's date
    const today = new Date().toLocaleString("en-US", { timeZone: "America/New_York" }); // Adjust timeZone as per the US Standard Time zone
    // Convert today's date to epoch time (in milliseconds)
    const todayEpoch = new Date(today).getTime() / 1000; // Convert milliseconds to seconds
    try {
        // Check mongoose connection
        const dbStatus = await isDBConnected();
        const dbStatusMessage = (dbStatus === true) ? messageCode.msgDbReady : messageCode.msgDbNotReady;
        console.log(dbStatusMessage);
        const isIssuerExist = await isValidIssuer(email);
        // Check if certificate number already exists
        const isNumberExist = await Issues.findOne({ certificateNumber: certificateNumber });
        // Check if certificate number already exists in the Batch
        const isNumberExistInBatch = await BatchIssues.findOne({ certificateNumber: certificateNumber });
        // Check if certificate number already exists in single Dynamic QR issue
        const isNumberExistInSingleDynamic = await DynamicIssues.findOne({ certificateNumber: certificateNumber });
        // Check if certificate number already exists in the Batch Dynamic QR issue
        const isNumberExistInBatchDynamic = await DynamicBatchIssues.findOne({ certificateNumber: certificateNumber });

        if (!isIssuerExist || (!isNumberExist && !isNumberExistInBatch && !isNumberExistInSingleDynamic && !isNumberExistInBatchDynamic)) {
            let errorMessage = messageCode.msgPlsEnterValid
            // Invalid Issuer
            if (!isIssuerExist) {
                errorMessage = messageCode.msgInvalidIssuer;
            } else {
                errorMessage = messageCode.msgCertNotExist;
            }
            return ({ code: 400, status: "FAILED", message: errorMessage });
        }
        var _certStatus = await getCertificationStatus(certStatus);
        const blockchainPreference = (!isIssuerExist.blockchainPreference || isIssuerExist.blockchainPreference == 0) ? 0 : 1;

        try {
            if (isNumberExist) {
                if (isNumberExist.certificateStatus != 3 && certStatus == 4) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgReactivationNotPossible });
                }

                if (isNumberExist.certificateStatus == parseInt(certStatus)) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgStatusAlreadyExist });
                }

                var blockchainOption = (!isNumberExist.blockchainOption || isNumberExist.blockchainOption == 0) ? 0 : 1;

                if (blockchainPreference != blockchainOption) {
                    if (blockchainPreference == 0) {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToStandby };
                    } else {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToPolygon };
                    }
                }

                var newContract;
                if (blockchainOption == 0) {
                    newContract = await connectToPolygon();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                } else {
                    newContract = await connectToStandby();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                }

                try {
                    let _getCertificateStatus = await newContract.getCertificateStatus(certificateNumber);
                    let getVerifyResponse = await newContract.verifyCertificateById(certificateNumber);
                    let statusResponse = parseInt(getVerifyResponse[2]);

                    if (isNumberExist.expirationDate != "1") {
                        const epochExpiration = await convertDateToEpoch(isNumberExist.expirationDate);
                        if ((epochExpiration < todayEpoch) || (getVerifyResponse[0] == true && statusResponse == 5)) {
                            return ({ code: 400, status: "FAILED", message: messageCode.msgCertExpired });
                        }
                    }

                    const getCertificateStatus = parseInt(_getCertificateStatus);
                    if (getCertificateStatus == 0) {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgCertNotExist });
                    }
                    if (getCertificateStatus != certStatus) {

                        let { txHash, txFee } = await updateSingleCertificateStatusWithRetry(blockchainOption, certificateNumber, certStatus);
                        if (!txHash) {
                            return ({ code: 400, status: false, message: messageCode.msgFailedToUpdateStatusRetry, details: certificateNumber });
                        }

                        var polygonLink;
                        if (blockchainOption == 0) {
                            polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;
                        } else {
                            polygonLink = `https://${process.env.STANDBY_NETWORK}/tx/${txHash}`;
                        }

                        // Save Issue details (modified)
                        isNumberExist.certificateStatus = certStatus;
                        isNumberExist.transactionHash = txHash;
                        // Save certification data into database
                        await isNumberExist.save();

                        // If user with given id exists, update certificatesIssued transation fee
                        const previousrtransactionFee = isIssuerExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                        isIssuerExist.transactionFee = previousrtransactionFee + txFee;
                        await isIssuerExist.save(); // Save the changes to the existing user

                        var certificateData = {
                            issuerId: isIssuerExist.issuerId,
                            transactionHash: txHash,
                            certificateNumber: certificateNumber,
                            course: isNumberExist.course,
                            name: isNumberExist.name,
                            expirationDate: isNumberExist.expirationDate,
                            email: email,
                            certStatus: certStatus,
                            blockchainOption
                        };

                        // Insert certification status data into database
                        await insertIssueStatus(certificateData);

                        return ({ code: 200, status: "SUCCESS", message: `Updated status: ${_certStatus}`, details: isNumberExist });

                    } else {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgStatusAlreadyExist });
                    }
                } catch (error) {
                    // Internal server error
                    console.error(error);
                    return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
                }

            } else if (isNumberExistInBatch) {

                if (isNumberExistInBatch.expirationDate != "1") {
                    let epochExpiration = await convertDateToEpoch(isNumberExistInBatch.expirationDate);
                    if (epochExpiration < todayEpoch) {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgCertExpired });
                    }
                }

                if (isNumberExistInBatch.certificateStatus != 3 && certStatus == 4) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgReactivationNotPossible });
                }

                var blockchainOption = (!isNumberExistInBatch.blockchainOption || isNumberExistInBatch.blockchainOption == 0) ? 0 : 1;

                if (blockchainPreference != blockchainOption) {
                    if (blockchainPreference == 0) {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToStandby };
                    } else {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToPolygon };
                    }
                }

                var newContract;
                if (blockchainOption == 0) {
                    newContract = await connectToPolygon();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                } else {
                    newContract = await connectToStandby();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                }

                try {
                    // let fetchIndex = isNumberExistInBatch.batchId - 1;
                    let hashedProof = isNumberExistInBatch.encodedProof;
                    // Blockchain calls
                    // let batchStatusResponse = await newContract.verifyBatchRoot(fetchIndex);

                    // if (batchStatusResponse[0] === true) {
                    if (isNumberExistInBatch.certificateStatus == parseInt(certStatus)) {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgStatusAlreadyExist });
                    }

                    let { txHash, txFee } = await updateCertificateStatusInBatchWithRetry(blockchainOption, hashedProof, certStatus);
                    if (!txHash) {
                        return ({ code: 400, status: false, message: messageCode.msgFailedToUpdateStatusRetry, details: certStatus });
                    }

                    var polygonLink;
                    if (blockchainOption == 0) {
                        polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;
                    } else {
                        polygonLink = `https://${process.env.STANDBY_NETWORK}/tx/${txHash}`;
                    }

                    // Save updated details (modified)
                    isNumberExistInBatch.certificateStatus = certStatus;
                    isNumberExistInBatch.transactionHash = txHash;

                    // Save certification data into database
                    await isNumberExistInBatch.save();

                    // If user with given id exists, update certificatesIssued transation fee
                    const previousrtransactionFee = isIssuerExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                    isIssuerExist.transactionFee = previousrtransactionFee + txFee;
                    await isIssuerExist.save(); // Save the changes to the existing user

                    var certificateData = {
                        issuerId: isIssuerExist.issuerId,
                        batchId: isNumberExistInBatch.batchId,
                        transactionHash: txHash,
                        certificateNumber: certificateNumber,
                        course: isNumberExistInBatch.course,
                        name: isNumberExistInBatch.name,
                        expirationDate: isNumberExistInBatch.expirationDate,
                        email: email,
                        certStatus: certStatus,
                        blockchainOption
                    };

                    // Insert certification status data into database
                    await insertIssueStatus(certificateData);

                    var statusDetails = { batchId: isNumberExistInBatch.batchId, certificateNumber: isNumberExistInBatch.certificateNumber, updatedStatus: _certStatus, polygonLink: polygonLink };
                    return ({ code: 200, status: "SUCCESS", message: messageCode.msgBatchStatusUpdated, details: statusDetails });

                    // } else {
                    //     return ({ code: 400, status: "FAILED", message: messageCode.msgCertNotExist });
                    // }
                } catch (error) {
                    // Internal server error
                    console.error(error);
                    return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
                }
            } else if (isNumberExistInSingleDynamic) {

                if (isNumberExistInSingleDynamic.certificateStatus != 3 && certStatus == 4) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgReactivationNotPossible });
                }

                if (isNumberExistInSingleDynamic.certificateStatus == parseInt(certStatus)) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgStatusAlreadyExist });
                }

                var blockchainOption = (!isNumberExistInSingleDynamic.blockchainOption || isNumberExistInSingleDynamic.blockchainOption == 0) ? 0 : 1;

                if (blockchainPreference != blockchainOption) {
                    if (blockchainPreference == 0) {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToStandby };
                    } else {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToPolygon };
                    }
                }

                var newContract;
                if (blockchainOption == 0) {
                    newContract = await connectToPolygon();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                } else {
                    newContract = await connectToStandby();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                }

                try {
                    let _getCertificateStatus = await newContract.getCertificateStatus(certificateNumber);
                    const getCertificateStatus = parseInt(_getCertificateStatus);
                    if (getCertificateStatus == 0) {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgCertNotExist });
                    }
                    if (getCertificateStatus != certStatus) {

                        let { txHash, txFee } = await updateSingleCertificateStatusWithRetry(blockchainOption, certificateNumber, certStatus);
                        if (!txHash) {
                            return ({ code: 400, status: false, message: messageCode.msgFailedToUpdateStatusRetry, details: certificateNumber });
                        }

                        var polygonLink;
                        if (blockchainOption == 0) {
                            polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;
                        } else {
                            polygonLink = `https://${process.env.STANDBY_NETWORK}/tx/${txHash}`;
                        }

                        // Save Issue details (modified)
                        isNumberExistInSingleDynamic.certificateStatus = certStatus;
                        isNumberExistInSingleDynamic.transactionHash = txHash;
                        // Save certification data into database
                        await isNumberExistInSingleDynamic.save();

                        // If user with given id exists, update certificatesIssued transation fee
                        const previousrtransactionFee = isIssuerExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                        isIssuerExist.transactionFee = previousrtransactionFee + txFee;
                        await isIssuerExist.save(); // Save the changes to the existing user

                        var certificateData = {
                            issuerId: isIssuerExist.issuerId,
                            transactionHash: txHash,
                            certificateNumber: certificateNumber,
                            course: 0,
                            name: isNumberExistInSingleDynamic.name,
                            expirationDate: 0,
                            email: email,
                            certStatus: certStatus,
                            blockchainOption
                        };

                        // Insert certification status data into database
                        await insertDynamicIssueStatus(certificateData);

                        return ({ code: 200, status: "SUCCESS", message: `Updated status: ${_certStatus}`, details: isNumberExistInSingleDynamic });

                    } else {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgStatusAlreadyExist });
                    }
                } catch (error) {
                    // Internal server error
                    console.error(error);
                    return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
                }
            } else if (isNumberExistInBatchDynamic) {

                if (isNumberExistInBatchDynamic.certificateStatus != 3 && certStatus == 4) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgReactivationNotPossible });
                }

                if (isNumberExistInBatchDynamic.certificateStatus == parseInt(certStatus)) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgStatusAlreadyExist });
                }

                var blockchainOption = (!isNumberExistInBatchDynamic.blockchainOption || isNumberExistInBatchDynamic.blockchainOption == 0) ? 0 : 1;

                if (blockchainPreference != blockchainOption) {
                    if (blockchainPreference == 0) {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToStandby };
                    } else {
                        return { code: 400, status: "FAILED", message: messageCode.msgSetChainToPolygon };
                    }
                }

                var newContract;
                if (blockchainOption == 0) {
                    newContract = await connectToPolygon();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                } else {
                    newContract = await connectToStandby();
                    if (!newContract) {
                        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
                    }
                }

                try {
                    // let fetchIndex = isNumberExistInBatchDynamic.batchId - 1;
                    let hashedProof = isNumberExistInBatchDynamic.encodedProof;
                    // Blockchain calls
                    // let batchStatusResponse = await newContract.verifyBatchRoot(fetchIndex);

                    // if (batchStatusResponse[0] === true) {
                    if (isNumberExistInBatchDynamic.certificateStatus == parseInt(certStatus)) {
                        return ({ code: 400, status: "FAILED", message: messageCode.msgStatusAlreadyExist });
                    }

                    let { txHash, txFee } = await updateCertificateStatusInBatchWithRetry(blockchainOption, hashedProof, certStatus);
                    if (!txHash) {
                        return ({ code: 400, status: false, message: messageCode.msgFailedToUpdateStatusRetry, details: certStatus });
                    }

                    var polygonLink;
                    if (blockchainOption == 0) {
                        polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;
                    } else {
                        polygonLink = `https://${process.env.STANDBY_NETWORK}/tx/${txHash}`;
                    }

                    // Save updated details (modified)
                    isNumberExistInBatchDynamic.certificateStatus = certStatus;
                    isNumberExistInBatchDynamic.transactionHash = txHash;

                    // Save certification data into database
                    await isNumberExistInBatchDynamic.save();

                    // If user with given id exists, update certificatesIssued transation fee
                    const previousrtransactionFee = isIssuerExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                    isIssuerExist.transactionFee = previousrtransactionFee + txFee;
                    await isIssuerExist.save(); // Save the changes to the existing user


                    var certificateData = {
                        issuerId: isIssuerExist.issuerId,
                        batchId: isNumberExistInBatchDynamic.batchId,
                        transactionHash: txHash,
                        certificateNumber: certificateNumber,
                        course: 0,
                        name: isNumberExistInBatchDynamic.name,
                        expirationDate: 0,
                        email: email,
                        certStatus: certStatus,
                        blockchainOption
                    };

                    // Insert certification status data into database
                    await insertDynamicIssueStatus(certificateData);

                    var statusDetails = { batchId: isNumberExistInBatchDynamic.batchId, certificateNumber: isNumberExistInBatchDynamic.certificateNumber, updatedStatus: _certStatus, polygonLink: polygonLink };
                    return ({ code: 200, status: "SUCCESS", message: messageCode.msgBatchStatusUpdated, details: statusDetails });

                    // } else {
                    //     return ({ code: 400, status: "FAILED", message: messageCode.msgCertNotExist });
                    // }
                } catch (error) {
                    // Internal server error
                    console.error(error);
                    return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
                }
            } else {
                return ({ code: 400, status: "FAILED", message: messageCode.msgCertNotExist });
            }

        } catch (error) {
            // Handle any errors that occur during token verification or validation
            return ({ code: 500, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
        }
    } catch (error) {
        // Handle any errors that occur during token verification or validation
        return ({ code: 500, status: "FAILED", message: messageCode.msgInternalError, details: error });
    }
};

const handleRenewBatchOfCertifications = async (email, batchId, batchExpirationDate) => {
    const newContract = await connectToPolygon();
    if (!newContract) {
        return ({ code: 400, status: "FAILED", message: messageCode.msgRpcFailed });
    }
    const expirationDate = batchExpirationDate != 1 ? await convertDateFormat(batchExpirationDate) : 1;
    // Get today's date
    var today = new Date(); // Adjust timeZone as per the US Standard Time zone
    // Convert today's date to epoch time (in milliseconds)
    var todayEpoch = today.getTime() / 1000; // Convert milliseconds to seconds

    var epochExpiration = batchExpirationDate != 1 ? await convertDateToEpoch(expirationDate) : 1;

    try {
        // Check mongoose connection
        const dbStatus = await isDBConnected();
        const dbStatusMessage = (dbStatus == true) ? messageCode.msgDbReady : messageCode.msgDbNotReady;
        console.log(dbStatusMessage);

        const isIssuerExist = await isValidIssuer(email);
        const rootIndex = parseInt(batchId) - 1;

        if (!isIssuerExist) {
            return ({ code: 400, status: "FAILED", message: messageCode.msgInvalidIssuer });
        }
        try {
            // Verify certificate on blockchain
            const isPaused = await newContract.paused();
            const issuerAuthorized = await newContract.hasRole(process.env.ISSUER_ROLE, isIssuerExist.issuerId);

            if (
                issuerAuthorized === false ||
                isPaused === true
            ) {
                // Issuer not authorized / contract paused
                if (isPaused === true) {
                    var messageContent = messageCode.msgOpsRestricted;
                } else if (issuerAuthorized === false) {
                    var messageContent = messageCode.msgIssuerUnauthrized;
                }
                return ({ code: 400, status: "FAILED", message: messageContent });
            }

            var _rootIndex = parseInt(rootIndex);
            const verifyBatchResponse = await newContract.verifyBatchRoot(_rootIndex);
            // const _getIndex = await newContract.getRootLength();
            // var getIndex = parseInt(_getIndex);
            // if (batchId > getIndex || batchId <= 0) {
            //     return ({ code: 400, status: "FAILED", message: messageCode.msgInvalidBatch });
            // }
            var batchResponse = parseInt(verifyBatchResponse[1]);
            if (batchResponse == 1) {
                return ({ code: 400, status: "FAILED", message: messageCode.msgUpdateBatchExpirationNotPossible });
            }
            if (verifyBatchResponse[0] === true && batchResponse != 0) {
                var batchEpoch = parseInt(verifyBatchResponse[1]);
                if (batchEpoch < todayEpoch) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgBatchExpired });
                }

                var batchStatusResponse = parseInt(verifyBatchResponse[2]);
                if (batchStatusResponse == 3) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgNotPossibleOnRevokedBatch });
                }

                var expirationEpochToDate = await convertEpochToDate(batchEpoch);

                const certDateValidation = await expirationDateVariaton(expirationEpochToDate, expirationDate);

                if (certDateValidation == 0 || certDateValidation == 2) {
                    // Respond with error message
                    return ({ code: 400, status: "FAILED", message: `${messageCode.msgEpirationMustGreater}: ${expirationDate}` });
                }

                var { txHash, txFee } = await updateBatchCertificateExpirationWithRetry(_rootIndex, epochExpiration);
                if (!txHash) {
                    return ({ code: 400, status: false, message: messageCode.msgFailedToRenewRetry, details: epochExpiration });
                }

                var polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;

                // If user with given id exists, update certificatesIssued transation fee
                const previousrtransactionFee = isIssuerExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                isIssuerExist.transactionFee = previousrtransactionFee + txFee;
                await isIssuerExist.save(); // Save the changes to the existing user


                var statusDetails = { batchId: batchId, updatedExpirationDate: expirationDate, polygonLink: polygonLink };
                return ({ code: 200, status: "SUCCESS", message: messageCode.msgBatchRenewed, details: statusDetails });

            } else if (verifyBatchResponse[0] === true && batchResponse == 0) {
                return ({ code: 400, status: "FAILED", message: messageCode.msgNotPossibleBatch });
            }

        } catch (error) {
            return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
        }

    } catch (error) {
        return ({ code: 500, status: "FAILED", message: messageCode.msgInternalError, details: error });
    }
};

const handleUpdateBatchCertificationStatus = async (email, batchId, certStatus) => {
    const newContract = await connectToPolygon();
    if (!newContract) {
        return ({ code: 400, status: "FAILED", message: messageCode.msgRpcFailed });
    }
    // Get today's date
    var today = new Date(); // Adjust timeZone as per the US Standard Time zone
    // Convert today's date to epoch time (in milliseconds)
    var todayEpoch = today.getTime() / 1000; // Convert milliseconds to seconds
    try {
        // Check mongoose connection
        const dbStatus = await isDBConnected();
        const dbStatusMessage = (dbStatus == true) ? messageCode.msgDbReady : messageCode.msgDbNotReady;
        console.log(dbStatusMessage);

        const isIssuerExist = await isValidIssuer(email);
        const rootIndex = batchId - 1;

        if (!isIssuerExist) {
            return ({ code: 400, status: "FAILED", message: messageCode.msgInvalidIssuer });
        }
        var _certStatus = await getCertificationStatus(certStatus);
        try {
            // Verify certificate on blockchain
            const isPaused = await newContract.paused();
            const issuerAuthorized = await newContract.hasRole(process.env.ISSUER_ROLE, isIssuerExist.issuerId);

            if (
                issuerAuthorized === false ||
                isPaused === true
            ) {
                // Issuer not authorized / contract paused
                if (isPaused === true) {
                    var messageContent = messageCode.msgOpsRestricted;
                } else if (issuerAuthorized === false) {
                    var messageContent = messageCode.msgIssuerUnauthrized;
                }
                return ({ code: 400, status: "FAILED", message: messageContent });
            }

            var _rootIndex = parseInt(rootIndex);
            const verifyBatchResponse = await newContract.verifyBatchRoot(_rootIndex);
            // const getIndex = await newContract.getRootLength();
            // if (getIndex <= _rootIndex) {
            //     return ({ code: 400, status: "FAILED", message: messageCode.msgInvalidBatch });
            // }
            var batchResponse = parseInt(verifyBatchResponse[1]);
            if (verifyBatchResponse[0] === true && batchResponse != 0) {
                var batchExpirationEpoch = parseInt(verifyBatchResponse[1]);
                if (batchExpirationEpoch < todayEpoch) {
                    return ({ code: 400, status: "FAILED", message: messageCode.msgBatchExpired });
                }

                var { txHash, txFee } = await updateBatchCertificateStatusWithRetry(_rootIndex, certStatus);
                if (!txHash) {
                    return ({ code: 400, status: false, message: messageCode.msgFailedToUpdateStatusRetry, details: _certStatus });
                }

                var polygonLink = `https://${process.env.NETWORK}/tx/${txHash}`;

                // If user with given id exists, update certificatesIssued transation fee
                const previousrtransactionFee = isIssuerExist.transactionFee || 0; // Initialize to 0 if transactionFee field doesn't exist
                isIssuerExist.transactionFee = previousrtransactionFee + txFee;
                await isIssuerExist.save(); // Save the changes to the existing user


                var statusDetails = { batchId: batchId, updatedBatchStatus: _certStatus, polygonLink: polygonLink };
                return ({ code: 200, status: "SUCCESS", message: messageCode.msgBatchStatusUpdated, details: statusDetails });

            } else if (verifyBatchResponse[0] === true && batchResponse == 0) {
                return ({ code: 400, status: "FAILED", message: messageCode.msgNotPossibleBatch });
            }

        } catch (error) {
            return ({ code: 400, status: "FAILED", message: messageCode.msgFailedAtBlockchain, details: error });
        }

    } catch (error) {
        return ({ code: 500, status: "FAILED", message: messageCode.msgInternalError, details: error });
    }

};

// Function to compare Existed Expiration date with Input date for Epiration extension
const expirationDateVariaton = async (_oldExpirationDate, _newExpirationDate) => {
    // Split the date strings into parts
    const [month1, day1, year1] = _oldExpirationDate.split('/');
    const [month2, day2, year2] = _newExpirationDate.split('/');

    const oldExpirationDate = new Date(2000 + parseInt(year1), month1 - 1, day1);
    const newExpirationDate = new Date(2000 + parseInt(year2), month2 - 1, day2);

    // console.log("Dates converted", oldExpirationDate, newExpirationDate);

    if (oldExpirationDate < newExpirationDate) {
        console.log("New date is Greater than Old Exipration date");
        return 1;
    } else if (oldExpirationDate > newExpirationDate) {
        console.log("Old date is Greater than New Exipration date");
        return 2;
    } else {
        console.log("Both Dates are Equal");
        return 0;
    }
};

// Function to Perform Extend expiration of Single Certificate with retry mechanism 
const renewSingleCertificateExpirationWithRetry = async (blockchainPreference, certificateNumber, combinedHash, epochExpiration, retryCount = 3) => {
    var newContract;
    if (blockchainPreference == 0) {
        newContract = await connectToPolygonIssue();
    } else {
        newContract = await connectToStandbyIssue();
    }
    if (!newContract) {
        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
    }
    // Perform Extend expiration of Single Certificate with retry mechanism
    try {
        // Issue Single Certifications on Blockchain
        const tx = await newContract.renewCertificate(
            certificateNumber,
            combinedHash,
            epochExpiration
        );

        var txHash = tx.hash;
        let txFee = await fetchOrEstimateTransactionFee(tx);
        if (!txHash) {
            if (retryCount > 0) {
                console.log(`Unable to process the transaction. Retrying... Attempts left: ${retryCount}`);
                // Retry after a delay (e.g., 1.5 seconds)
                await holdExecution(1500);
                return renewSingleCertificateExpirationWithRetry(blockchainPreference, certificateNumber, combinedHash, epochExpiration, retryCount - 1);
            }
        }

        return {
            txHash: txHash,
            txFee: txFee
        };

    } catch (error) {
        if (retryCount > 0 && error.code === 'ETIMEDOUT') {
            console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
            // Retry after a delay (e.g., 2 seconds)
            await holdExecution(2000);
            return renewSingleCertificateExpirationWithRetry(blockchainPreference, certificateNumber, combinedHash, epochExpiration, retryCount - 1);
        } else if (error.code === 'NONCE_EXPIRED') {
            // Extract and handle the error reason
            console.error("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else if (error.reason) {
            // Extract and handle the error reason
            console.error("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else {
            // If there's no specific reason provided, handle the error generally
            console.error(messageCode.msgFailedOpsAtBlockchain, error);
            return {
                txHash: null,
                txFee: null
            };
        }
    }
};

// Function to Perform Extend expiration of Certificate in the batch with retry mechanism 
const renewCertificateExpirationInBatchWithRetry = async (blockchainPreference, fetchIndex, hashedProof, epochExpiration, retryCount = 3) => {
    var newContract;
    if (blockchainPreference == 0) {
        newContract = await connectToPolygonIssue();
    } else {
        newContract = await connectToStandbyIssue();
    }
    if (!newContract) {
        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
    }
    // Perform Extend expiration of Certificate in the batch with retry mechanism 
    try {
        // Issue Single Certifications on Blockchain
        const tx = await newContract.renewCertificateInBatch(
            fetchIndex,
            hashedProof,
            epochExpiration
        );

        let txHash = tx.hash;
        let txFee = await fetchOrEstimateTransactionFee(tx);
        if (!txHash) {
            if (retryCount > 0) {
                console.log(`Unable to process the transaction. Retrying... Attempts left: ${retryCount}`);
                // Retry after a delay (e.g., 1.5 seconds)
                await holdExecution(1500);
                return renewCertificateExpirationInBatchWithRetry(blockchainPreference, fetchIndex, hashedProof, epochExpiration, retryCount - 1);
            }
        }

        return {
            txHash: txHash,
            txFee: txFee
        };

    } catch (error) {
        if (retryCount > 0 && error.code === 'ETIMEDOUT') {
            console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
            // Retry after a delay (e.g., 2 seconds)
            await holdExecution(2000);
            return renewCertificateExpirationInBatchWithRetry(blockchainPreference, fetchIndex, hashedProof, epochExpiration, retryCount - 1);
        } else if (error.code === 'NONCE_EXPIRED') {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else if (error.reason) {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else {
            // If there's no specific reason provided, handle the error generally
            // console.error(messageCode.msgFailedOpsAtBlockchain, error);
            return {
                txHash: null,
                txFee: null
            };
        }
    }
};

// Function to Perform Update Single Certificate status with retry mechanism 
const updateSingleCertificateStatusWithRetry = async (blockchainPreference, certificateNumber, certStatus, retryCount = 3) => {
    var newContract;
    if (blockchainPreference == 0) {
        newContract = await connectToPolygonIssue();
    } else {
        newContract = await connectToStandbyIssue();
    }
    if (!newContract) {
        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
    }
    try {
        // Perform Update Single Certificate status with retry mechanism 
        const tx = await newContract.updateSingleCertificateStatus(
            certificateNumber,
            certStatus
        );

        let txHash = tx.hash;
        let txFee = await fetchOrEstimateTransactionFee(tx);
        if (!txHash) {
            if (retryCount > 0) {
                console.log(`Unable to process the transaction. Retrying... Attempts left: ${retryCount}`);
                // Retry after a delay (e.g., 1.5 seconds)
                await holdExecution(1500);
                return updateSingleCertificateStatusWithRetry(blockchainPreference, certificateNumber, certStatus, retryCount - 1);
            }
        }

        return {
            txHash: txHash,
            txFee: txFee
        };

    } catch (error) {
        if (retryCount > 0 && error.code === 'ETIMEDOUT') {
            console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
            // Retry after a delay (e.g., 2 seconds)
            await holdExecution(2000);
            return updateSingleCertificateStatusWithRetry(blockchainPreference, certificateNumber, certStatus, retryCount - 1);
        } else if (error.code === 'NONCE_EXPIRED') {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else if (error.reason) {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else {
            // If there's no specific reason provided, handle the error generally
            // console.error(messageCode.msgFailedOpsAtBlockchain, error);
            return {
                txHash: null,
                txFee: null
            };
        }
    }
};

// Function to Perform Update Certificate status in Batch with retry mechanism 
const updateCertificateStatusInBatchWithRetry = async (blockchainPreference, hashedProof, certStatus, retryCount = 3) => {
    var newContract;
    if (blockchainPreference == 0) {
        newContract = await connectToPolygonIssue();
    } else {
        newContract = await connectToStandbyIssue();
    }
    if (!newContract) {
        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
    }
    try {
        // Perform Update Certificate status in Batch with retry mechanism
        const tx = await newContract.updateCertificateInBatchStatus(
            hashedProof,
            certStatus
        );

        let txHash = tx.hash;
        let txFee = await fetchOrEstimateTransactionFee(tx);
        if (!txHash) {
            if (retryCount > 0) {
                console.log(`Unable to process the transaction. Retrying... Attempts left: ${retryCount}`);
                // Retry after a delay (e.g., 1.5 seconds)
                await holdExecution(1500);
                return updateCertificateStatusInBatchWithRetry(blockchainPreference, certificateNumber, certificateHash, expirationEpoch, retryCount - 1);
            }
        }

        return {
            txHash: txHash,
            txFee: txFee
        };

    } catch (error) {
        if (retryCount > 0 && error.code === 'ETIMEDOUT') {
            console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
            // Retry after a delay (e.g., 2 seconds)
            await holdExecution(2000);
            return updateCertificateStatusInBatchWithRetry(blockchainPreference, certificateNumber, certificateHash, expirationEpoch, retryCount - 1);
        } else if (error.code === 'NONCE_EXPIRED') {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else if (error.reason) {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else {
            // If there's no specific reason provided, handle the error generally
            // console.error(messageCode.msgFailedOpsAtBlockchain, error);
            return {
                txHash: null,
                txFee: null
            };
        }
    }
};

// Function to Perform Extend Batch expiration with retry mechanism 
const updateBatchCertificateExpirationWithRetry = async (blockchainPreference, rootIndex, expirationEpoch, retryCount = 3) => {
    var newContract;
    if (blockchainPreference == 0) {
        newContract = await connectToPolygonIssue();
    } else {
        newContract = await connectToStandbyIssue();
    }
    if (!newContract) {
        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
    }
    try {
        // Perform Extend Batch expiration with retry mechanism 
        const tx = await newContract.renewBatchOfCertificates(
            rootIndex,
            expirationEpoch
        );

        let txHash = tx.hash;
        let txFee = await fetchOrEstimateTransactionFee(tx);
        if (!txHash) {
            if (retryCount > 0) {
                console.log(`Unable to process the transaction. Retrying... Attempts left: ${retryCount}`);
                // Retry after a delay (e.g., 1.5 seconds)
                await holdExecution(1500);
                return updateBatchCertificateExpirationWithRetry(blockchainPreference, rootIndex, expirationEpoch, retryCount - 1);
            }
        }

        return {
            txHash: txHash,
            txFee: txFee
        };

    } catch (error) {
        if (retryCount > 0 && error.code === 'ETIMEDOUT') {
            console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
            // Retry after a delay (e.g., 2 seconds)
            await holdExecution(2000);
            return updateBatchCertificateExpirationWithRetry(blockchainPreference, rootIndex, expirationEpoch, retryCount - 1);
        } else if (error.code === 'NONCE_EXPIRED') {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else if (error.reason) {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else {
            // If there's no specific reason provided, handle the error generally
            // console.error(messageCode.msgFailedOpsAtBlockchain, error);
            return {
                txHash: null,
                txFee: null
            };
        }
    }
};

// Function to Perform Update Batch Status with retry mechanism 
const updateBatchCertificateStatusWithRetry = async (blockchainPreference, rootIndex, certStatus, retryCount = 3) => {
    var newContract;
    if (blockchainPreference == 0) {
        newContract = await connectToPolygonIssue();
    } else {
        newContract = await connectToStandbyIssue();
    }
    if (!newContract) {
        return { code: 400, status: "FAILED", message: messageCode.msgRpcFailed };
    }
    try {
        // Perform Update Batch Status with retry mechanism 
        const tx = await newContract.updateBatchCertificateStatus(
            rootIndex,
            certStatus
        );

        let txHash = tx.hash;
        let txFee = await fetchOrEstimateTransactionFee(tx);
        if (!txHash) {
            if (retryCount > 0) {
                console.log(`Unable to process the transaction. Retrying... Attempts left: ${retryCount}`);
                // Retry after a delay (e.g., 1.5 seconds)
                await holdExecution(1500);
                return updateBatchCertificateStatusWithRetry(blockchainPreference, rootIndex, certStatus, retryCount - 1);
            }
        }
        return {
            txHash: txHash,
            txFee: txFee
        };

    } catch (error) {
        if (retryCount > 0 && error.code === 'ETIMEDOUT') {
            console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
            // Retry after a delay (e.g., 2 seconds)
            await holdExecution(2000);
            return updateBatchCertificateStatusWithRetry(blockchainPreference, rootIndex, certStatus, retryCount - 1);
        } else if (error.code === 'NONCE_EXPIRED') {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else if (error.reason) {
            // Extract and handle the error reason
            // console.log("Error reason:", error.reason);
            return {
                txHash: null,
                txFee: null
            };
        } else {
            // If there's no specific reason provided, handle the error generally
            // console.error(messageCode.msgFailedOpsAtBlockchain, error);
            return {
                txHash: null,
                txFee: null
            };
        }
    }
};

module.exports = {
    // Function to renew (extend expiration) a single certification
    handleRenewCertification,

    // Function to update status revoke/reactivation single certification
    handleUpdateCertificationStatus,

    // Function to renew (extend expiration) to a batch certification
    handleRenewBatchOfCertifications,

    // Function to update status revoke/reactivation to a Batch certification
    handleUpdateBatchCertificationStatus
};