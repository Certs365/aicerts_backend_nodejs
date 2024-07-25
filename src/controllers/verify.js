// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const express = require("express");
const app = express(); // Create an instance of the Express application
const path = require("path");
const fs = require("fs");
const axios = require('axios');
const moment = require('moment');
const { ethers } = require("ethers"); // Ethereum JavaScript library
const { validationResult } = require("express-validator");
// Import custom cryptoFunction module for encryption and decryption
const { decryptData, generateEncryptedUrl } = require("../common/cryptoFunction");

const pdf = require("pdf-lib"); // Library for creating and modifying PDF documents
const { PDFDocument } = pdf;

// Import MongoDB models
const { ShortUrl, DynamicIssues } = require("../config/schema");

// Import ABI (Application Binary Interface) from the JSON file located at "../config/abi.json"
const abi = require("../config/abi.json");

// Importing functions from a custom module
const {
  extractQRCodeDataFromPDF, // Function to extract QR code data from a PDF file
  cleanUploadFolder, // Function to clean up the upload folder
  isDBConnected, // Function to check if the database connection is established
  extractCertificateInfo,
  verificationLogEntry,
  isCertificationIdExisted,
  holdExecution
} = require('../model/tasks'); // Importing functions from the '../model/tasks' module

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

var messageCode = require("../common/codes");
const e = require('express');

const urlLimit = process.env.MAX_URL_SIZE || 50;

/**
 * Verify Certification page with PDF QR - Blockchain URL.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */
const verify = async (req, res) => {
  // Extracting file path from the request
  file = req.file.path;

  var fileBuffer = fs.readFileSync(file);
  var pdfDoc = await PDFDocument.load(fileBuffer);
  var certificateS3Url;
  var responseUrl;
  var verificationResponse;
  // Get today's date
  const getTodayDate = async () => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Add leading zero if month is less than 10
    const day = String(today.getDate()).padStart(2, '0'); // Add leading zero if day is less than 10
    const year = today.getFullYear();
    return `${month}/${day}/${year}`;
  };
  const todayDate = await getTodayDate();

  if (pdfDoc.getPageCount() > 1) {
    // Respond with success status and certificate details
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    // Clean up the upload folder
    await cleanUploadFolder();
    return res.status(400).json({ status: "FAILED", message: messageCode.msgMultiPagePdf });
  }

  try {
    // Extract QR code data from the PDF file
    const certificateData = await extractQRCodeDataFromPDF(file);

    if (certificateData == false) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
      // Clean up the upload folder
      await cleanUploadFolder();
      return res.status(400).json({ status: "FAILED", message: messageCode.msgCertNotValid });
    }

    if (certificateData.startsWith(process.env.START_URL) || certificateData.startsWith(process.env.START_VERIFY_URL)) {
      var urlSize = certificateData.length;
      if (urlSize < urlLimit) {
        // Parse the URL
        const parsedUrl = new URL(certificateData);
        // Extract the query parameter
        const certificationNumber = parsedUrl.searchParams.get('');

        try {
          await isDBConnected();
          var isIdExist = await isCertificationIdExisted(certificationNumber);
          if (isIdExist) {
            var blockchainResponse = 0;
            if (isIdExist.batchId == undefined) {
              blockchainResponse = await verifySingleCertificationWithRetry(certificationNumber);
            } else if (isIdExist.batchId != undefined) {
              let batchNumber = (isIdExist.batchId) - 1;
              let dataHash = isIdExist.certificateHash;
              let proof = isIdExist.proofHash;
              let hashProof = isIdExist.encodedProof;
              blockchainResponse = await verifyBatchCertificationWithRetry(batchNumber, dataHash, proof, hashProof);
            }
            if (blockchainResponse == 2 || blockchainResponse == 3) {
              if (blockchainResponse == 2) {
                verificationResponse = messageCode.msgCertExpired;
              } else if (blockchainResponse == 3) {
                verificationResponse = messageCode.msgCertRevoked;
              }
              return res.status(400).json({ status: "FAILED", message: verificationResponse });
            }
          }
          var isUrlExisted = await ShortUrl.findOne({ certificateNumber: certificationNumber });
          var isDynamicCertificateExist = await DynamicIssues.findOne({ certificateNumber: certificationNumber });
          if (isIdExist) {
            if (isIdExist.certificateStatus == 6) {
              var _polygonLink = `https://${process.env.NETWORK}/tx/${isIdExist.transactionHash}`;

              var completeResponse = {
                'Certificate Number': isIdExist.certificateNumber,
                'Name': isIdExist.name,
                'Course Name': isIdExist.course,
                'Grant Date': isIdExist.grantDate,
                'Expiration Date': isIdExist.expirationDate,
                'Polygon URL': _polygonLink
              };

              if (urlIssueExist) {
                completeResponse.url = urlIssueExist.url;
              } else {
                completeResponse.url = null;
              }
              if (fs.existsSync(file)) {
                fs.unlinkSync(file);
              }
              // Clean up the upload folder
              await cleanUploadFolder();

              res.status(200).json({
                status: "SUCCESS",
                message: "Certification is valid",
                details: completeResponse
              });
              return;
            }

            let originalUrl = isUrlExisted != null ? isUrlExisted.url : null;
            let certUrl = (isIdExist.url != undefined && (isIdExist.url).length > 1) ? isIdExist.url : null;
            let formattedResponse = {
              "Certificate Number": isIdExist.certificateNumber,
              "Name": isIdExist.name,
              "Course Name": isIdExist.course,
              "Grant Date": isIdExist.grantDate,
              "Expiration Date": isIdExist.expirationDate,
              "Polygon URL": `${process.env.NETWORK}/tx/${isIdExist.transactionHash}`,
              "url": originalUrl,
              "certificateUrl": certUrl
            }
            if (isIdExist.certificateStatus == 3) {
              if (fs.existsSync(file)) {
                fs.unlinkSync(file);
              }
              // Clean up the upload folder
              await cleanUploadFolder();
              return res.status(400).json({ status: "FAILED", message: messageCode.msgCertRevoked });
            }

            certificateS3Url = isIdExist.url != null ? isIdExist.url : null;
            formattedResponse.certificateUrl = certificateS3Url;
            var verifyLog = {
              issuerId: isIdExist.issuerId,
              course: isIdExist.course,
            };
            await verificationLogEntry(verifyLog);
            if (fs.existsSync(file)) {
              fs.unlinkSync(file);
            }
            // Clean up the upload folder
            await cleanUploadFolder();
            return res.status(200).json({ status: "SUCCESS", message: messageCode.msgCertValid, details: formattedResponse });

          } else if (isDynamicCertificateExist) {
            let originalUrl = isUrlExisted != null ? isUrlExisted.url : null;
            let responseFields = isDynamicCertificateExist.certificateFields;
            let formattedDynamicResponse = {
              "Certificate Number": isDynamicCertificateExist.certificateNumber,
              "Name": isDynamicCertificateExist.name,
              "Custom Fields": responseFields,
              "Polygon URL": `${process.env.NETWORK}/tx/${isDynamicCertificateExist.transactionHash}`,
              "type": isDynamicCertificateExist.type,
              "url": originalUrl,
              "certificateUrl": null
            }

            if (fs.existsSync(file)) {
              fs.unlinkSync(file);
            }
            // Clean up the upload folder
            await cleanUploadFolder();
            return res.status(200).json({ status: "SUCCESS", message: messageCode.msgCertValid, details: formattedDynamicResponse });
          } else {
            return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });
          }

        } catch (error) {
          return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert, details: error });
        }
      }

      responseUrl = certificateData;
      var [extractQRData, encodedUrl] = await extractCertificateInfo(responseUrl);
      if (extractQRData) {
        try {
          var dbStatus = await isDBConnected();
          if (dbStatus) {
            var getCertificationInfo = await isCertificationIdExisted(extractQRData['Certificate Number']);
            certificateS3Url = null;
            if (getCertificationInfo) {
              certificateS3Url = getCertificationInfo.url != null ? getCertificationInfo.url : null;
              var formatCertificationStatus = parseInt(getCertificationInfo.certificateStatus);
              if (formatCertificationStatus && formatCertificationStatus == 3) {
                if (fs.existsSync(file)) {
                  fs.unlinkSync(file);
                }
                // Clean up the upload folder
                await cleanUploadFolder();
                return res.status(400).json({ status: "FAILED", message: messageCode.msgCertRevoked });
              }
            }
          }
        } catch (error) {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
          }
          // Clean up the upload folder
          await cleanUploadFolder();
          return res.status(500).json({ status: "FAILED", message: messageCode.msgInternalError, details: error });
        }
        extractQRData.url = encodedUrl;
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
        // Clean up the upload folder
        await cleanUploadFolder();

        extractQRData.certificateUrl = certificateS3Url;
        res.status(200).json({ status: "PASSED", message: messageCode.msgCertValid, details: extractQRData });
        return;
      }
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
      // Clean up the upload folder
      await cleanUploadFolder();
      return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });
    } else if (certificateData.startsWith(process.env.START_LMS)) {
      var [extractQRData, encodedUrl] = await extractCertificateInfo(certificateData);
      if (extractQRData["Polygon URL"] == undefined) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
        // Clean up the upload folder
        await cleanUploadFolder();
        return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });
      }
      if (extractQRData) {
        var verifyLog = {
          issuerId: 'default',
          course: extractQRData["Course Name"],
        };
        await verificationLogEntry(verifyLog);

        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
        // Clean up the upload folder
        await cleanUploadFolder();
        res.status(200).json({ status: "PASSED", message: messageCode.msgCertValid, details: extractQRData });
        return;
      }
      // Clean up the upload folder
      await cleanUploadFolder();
      return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });

    } else {
      // Clean up the upload folder
      await cleanUploadFolder();
      return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });
    }

  } catch (error) {
    // If an error occurs during verification, respond with failure status
    const verificationResponse = {
      status: "FAILED",
      message: messageCode.msgCertNotValid
    };

    res.status(400).json(verificationResponse);
    // Clean up the upload folder
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    // Clean up the upload folder
    await cleanUploadFolder();
    return;
  }
};

/**
 * Handles the decoding of a certificate from an encrypted link Fetched after Mobile/Webcam Scan.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */

const decodeQRScan = async (req, res) => {
  const receivedCode = req.body.receivedCode;
  if (!receivedCode) {
    // Respond with error message
    return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidInput });
  }
  // console.log("Input QR data", receivedCode);

  var responseUrl = null;
  var decodeResponse = false;
  var certificateS3Url;
  var verificationResponse;
  try {
    if (receivedCode.startsWith(process.env.START_URL) || receivedCode.startsWith(process.env.START_VERIFY_URL)) {
      var urlSize = receivedCode.length;
      if (urlSize < urlLimit) {
        // Parse the URL
        const parsedUrl = new URL(receivedCode);
        // Extract the query parameter
        const certificationNumber = parsedUrl.searchParams.get('');

        try {
          await isDBConnected();
          var isIdExist = await isCertificationIdExisted(certificationNumber);
          if (isIdExist) {
            var blockchainResponse = 0;
            if (isIdExist.batchId == undefined) {
              blockchainResponse = await verifySingleCertificationWithRetry(certificationNumber);
            } else if (isIdExist.batchId != undefined) {
              let batchNumber = (isIdExist.batchId) - 1;
              let dataHash = isIdExist.certificateHash;
              let proof = isIdExist.proofHash;
              let hashProof = isIdExist.encodedProof;
              blockchainResponse = await verifyBatchCertificationWithRetry(batchNumber, dataHash, proof, hashProof);
            }
            if (blockchainResponse == 2 || blockchainResponse == 3) {
              if (blockchainResponse == 2) {
                verificationResponse = messageCode.msgCertExpired;
              } else if (blockchainResponse == 3) {
                verificationResponse = messageCode.msgCertRevoked;
              }
              return res.status(400).json({ status: "FAILED", message: verificationResponse });
            }
          }
          var isUrlExisted = await ShortUrl.findOne({ certificateNumber: certificationNumber });
          var isDynamicCertificateExist = await DynamicIssues.findOne({ certificateNumber: certificationNumber });
          if (isIdExist) {
            let originalUrl = isUrlExisted != null ? isUrlExisted.url : null;
            let certUrl = (isIdExist.url != undefined && (isIdExist.url).length > 1) ? isIdExist.url : null;
            let formattedResponse = {
              "Certificate Number": isIdExist.certificateNumber,
              "Name": isIdExist.name,
              "Course Name": isIdExist.course,
              "Grant Date": isIdExist.grantDate,
              "Expiration Date": isIdExist.expirationDate,
              "Polygon URL": `${process.env.NETWORK}/tx/${isIdExist.transactionHash}`,
              "url": originalUrl,
              "certificateUrl": certUrl
            }
            if (isIdExist.certificateStatus == 3) {
              return res.status(400).json({ status: "FAILED", message: messageCode.msgCertRevoked });
            }

            var verifyLog = {
              issuerId: isIdExist.issuerId,
              course: isIdExist.course,
            };
            await verificationLogEntry(verifyLog);
            return res.status(200).json({ status: "SUCCESS", message: messageCode.msgCertValid, details: formattedResponse });

          } else if (isDynamicCertificateExist) {
            let originalUrl = isUrlExisted != null ? isUrlExisted.url : null;
            let responseFields = isDynamicCertificateExist.certificateFields;
            let formattedDynamicResponse = {
              "Certificate Number": isDynamicCertificateExist.certificateNumber,
              "Name": isDynamicCertificateExist.name,
              "Custom Fields": responseFields,
              "Polygon URL": `${process.env.NETWORK}/tx/${isDynamicCertificateExist.transactionHash}`,
              "type": isDynamicCertificateExist.type,
              "url": originalUrl
            }

            return res.status(200).json({ status: "SUCCESS", message: messageCode.msgCertValid, details: formattedDynamicResponse });
          } else {
            return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });
          }

        } catch (error) {
          return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert, details: error });
        }
      }
      responseUrl = receivedCode;
      var [extractQRData, encodedUrl] = await extractCertificateInfo(responseUrl);
      if (extractQRData) {
        try {
          var dbStatus = await isDBConnected();
          if (dbStatus) {
            var getCertificationInfo = await isCertificationIdExisted(extractQRData['Certificate Number']);
            certificateS3Url = null;
            if (getCertificationInfo) {
              certificateS3Url = getCertificationInfo.url != null ? getCertificationInfo.url : null;
              var formatCertificationStatus = parseInt(getCertificationInfo.certificateStatus);
              if (formatCertificationStatus && formatCertificationStatus == 3) {
                return res.status(400).json({ status: "FAILED", message: messageCode.msgCertRevoked });
              }
            }
          }
        } catch (error) {
          return res.status(500).json({ status: "FAILED", message: messageCode.msgInternalError, details: error });
        }
        extractQRData.url = encodedUrl;
        res.status(200).json({ status: "PASSED", message: messageCode.msgCertValid, details: extractQRData });
        return;
      }
      return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });

    } else if (receivedCode.startsWith(process.env.START_LMS)) {

      var [extractQRData, decodedUrl] = await extractCertificateInfo(receivedCode);
      if (extractQRData) {
        var verifyLog = {
          issuerId: 'default',
          course: extractQRData["Course Name"],
        };
        await verificationLogEntry(verifyLog);

        extractQRData.url = null;
        res.status(200).json({ status: "PASSED", message: messageCode.msgCertValid, Details: extractQRData });
        return;
      }
      return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });

    } else {
      return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });
    }
  } catch (error) {
    // Handle errors and send an appropriate response
    console.error(error);
    return res.status(500).json({ status: "FAILED", message: messageCode.msgInternalError });
  }
};

/**
 * Handles the decoding of a certificate from an encrypted link.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */
const decodeCertificate = async (req, res) => {
  try {
    // Extract encrypted link from the request body
    const encryptedData = req.body.encryptedData;
    const iv = req.body.iv;

    // Decrypt the link
    const decryptedData = decryptData(encryptedData, iv);

    const originalData = JSON.parse(decryptedData);

    var originalUrl = generateEncryptedUrl(originalData);

    let isValid = false;
    let messageContent = "Not Verified"
    let parsedData;
    var certificateS3Url;
    if (originalData !== null) {
      parsedData = {
        "Certificate Number": originalData.Certificate_Number || "",
        "Course Name": originalData.courseName || "",
        "Custom Fields": originalData.certificateFields || "",
        "Expiration Date": originalData.Expiration_Date || "",
        "Grant Date": originalData.Grant_Date || "",
        "Name": originalData.name || "",
        "Polygon URL": originalData.polygonLink || ""
      };

      var getCertificationInfo = await isCertificationIdExisted(parsedData['Certificate Number']);

      var verifyLog = {
        issuerId: "default",
        course: parsedData["Course Name"]
      };
      isValid = true
      var dbStatus = await isDBConnected();
      if (dbStatus) {
        var getValidCertificatioInfo = await isCertificationIdExisted(originalData.Certificate_Number);
        if (getValidCertificatioInfo) {
          certificateS3Url = getValidCertificatioInfo.url != null ? getValidCertificatioInfo.url : null;
          verifyLog.issuerId = getValidCertificatioInfo.issuerId;
          parsedData['Expiration Date'] = getValidCertificatioInfo.expirationDate;
          parsedData.certificateUrl = certificateS3Url;
          let formatCertificationStatus = parseInt(getCertificationInfo.certificateStatus);
          let certificationStatus = formatCertificationStatus || 0;
          if ((certificationStatus != 0) && (certificationStatus == 3)) {
            isValid = false;
            messageContent = "Certification has Revoked";
          }
        }
      }
    }

    // Respond with the verification status and decrypted data if valid
    if (isValid) {
      if (dbStatus && parsedData["Custom Fields"] == undefined) {
        await verificationLogEntry(verifyLog);
      }
      parsedData.url = originalUrl || null;
      res.status(200).json({ status: "PASSED", message: "Verified", data: parsedData });
    } else {
      res.status(200).json({ status: "FAILED", message: messageContent });
    }
  } catch (error) {
    // Handle errors and send an appropriate response
    console.error(error);
    res.status(500).json({ message: messageCode.msgInternalError });
  }
};

/**
 * API call for Single / Batch Certificates verify with Certification ID.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */

const verifyCertificationId = async (req, res) => {
  var validResult = validationResult(req);
  if (!validResult.isEmpty()) {
    return res.status(422).json({ status: "FAILED", message: messageCode.msgEnterInvalid, details: validResult.array() });
  }
  const inputId = req.body.id;
  var certificateS3Url;
  var verificationResponse;
  try {
    let dbStatus = await isDBConnected();
    const dbStatusMessage = (dbStatus === true) ? messageCode.msgDbReady : messageCode.msgDbNotReady;
    console.log(dbStatusMessage);
    try {
      await isDBConnected();
      var isIdExist = await isCertificationIdExisted(inputId);
      if (isIdExist) {
        var blockchainResponse = 0;
        if (isIdExist.batchId == undefined) {
          blockchainResponse = await verifySingleCertificationWithRetry(inputId);
        } else if (isIdExist.batchId != undefined) {
          let batchNumber = (isIdExist.batchId) - 1;
          let dataHash = isIdExist.certificateHash;
          let proof = isIdExist.proofHash;
          let hashProof = isIdExist.encodedProof;
          blockchainResponse = await verifyBatchCertificationWithRetry(batchNumber, dataHash, proof, hashProof);
        }
        console.log("The blockchain response", blockchainResponse);
        if (blockchainResponse == 2 || blockchainResponse == 3) {
          if (blockchainResponse == 2) {
            verificationResponse = messageCode.msgCertExpired;
          } else if (blockchainResponse == 3) {
            verificationResponse = messageCode.msgCertRevoked;
          }
          return res.status(400).json({ status: "FAILED", message: verificationResponse });
        }
      }

      var isUrlExisted = await ShortUrl.findOne({ certificateNumber: inputId });
      var isDynamicCertificateExist = await DynamicIssues.findOne({ certificateNumber: inputId });
      
      if (isIdExist) {

        if (isIdExist.certificateStatus == 6) {
          let _polygonLink = `https://${process.env.NETWORK}/tx/${isIdExist.transactionHash}`;

          var completeResponse = {
            'Certificate Number': isIdExist.certificateNumber,
            'Name': isIdExist.name,
            'Course Name': isIdExist.course,
            'Grant Date': isIdExist.grantDate,
            'Expiration Date': isIdExist.expirationDate,
            'Polygon URL': _polygonLink
          };

          if (urlIssueExist) {
            completeResponse.url = urlIssueExist.url;
          } else {
            completeResponse.url = null;
          }
          // Clean up the upload folder
          await cleanUploadFolder();

          res.status(200).json({
            status: "SUCCESS",
            message: "Certification is valid",
            details: completeResponse
          });
          return;
        }

        let originalUrl = isUrlExisted != null ? isUrlExisted.url : null;
        let certUrl = (isIdExist.url != undefined && (isIdExist.url).length > 1) ? isIdExist.url : null;
        let formattedResponse = {
          "Certificate Number": isIdExist.certificateNumber,
          "Name": isIdExist.name,
          "Course Name": isIdExist.course,
          "Grant Date": isIdExist.grantDate,
          "Expiration Date": isIdExist.expirationDate,
          "Polygon URL": `${process.env.NETWORK}/tx/${isIdExist.transactionHash}`,
          "url": originalUrl,
          "certificateUrl": certUrl
        }
        if (isIdExist.certificateStatus == 3) {
          return res.status(400).json({ status: "FAILED", message: messageCode.msgCertRevoked });
        }

        var verifyLog = {
          issuerId: isIdExist.issuerId,
          course: isIdExist.course,
        };
        await verificationLogEntry(verifyLog);
        return res.status(200).json({ status: "SUCCESS", message: messageCode.msgCertValid, details: formattedResponse });

      } else if (isDynamicCertificateExist) {
        let originalUrl = isUrlExisted != null ? isUrlExisted.url : null;
        let responseFields = isDynamicCertificateExist.certificateFields;
        let formattedDynamicResponse = {
          "Certificate Number": isDynamicCertificateExist.certificateNumber,
          "Name": isDynamicCertificateExist.name,
          "Custom Fields": responseFields,
          "Polygon URL": `${process.env.NETWORK}/tx/${isDynamicCertificateExist.transactionHash}`,
          "type": isDynamicCertificateExist.type,
          "url": originalUrl
        }

        return res.status(200).json({ status: "SUCCESS", message: messageCode.msgCertValid, details: formattedDynamicResponse });
      } else {
        return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert });
      }

    } catch (error) {
      return res.status(400).json({ status: "FAILED", message: messageCode.msgInvalidCert, details: error });
    }

  } catch (error) {
    return res.status(500).json({ status: "FAILED", message: messageCode.msgInternalError, details: error });
  }
};

// Function to verify the ID (Single) with Smart Contract with Retry
const verifySingleCertificationWithRetry = async (certificateId, retryCount = 3) => {
  console.log("Running");
  try {
    // Blockchain processing.
    let verifyCert = await newContract.verifyCertificateById(certificateId);
    let _certStatus = await newContract.getCertificateStatus(certificateId);

    if (verifyCert) {
      let verifyCertStatus = parseInt(verifyCert[3]);
      if (_certStatus) {
        let certStatus = parseInt(_certStatus);
        if (certStatus == 3) {
          return 3;
        }
      }
      if (verifyCert[0] === false && verifyCertStatus == 5) {
        return 2;
      }
      return 1;
    }
    return 0;
  } catch (error) {
    if (retryCount > 0 && error.code === 'ETIMEDOUT') {
      console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
      // Retry after a delay (e.g., 2 seconds)
      await holdExecution(2000);
      return verifySingleCertificationWithRetry(certificateId, retryCount - 1);
    } else if (error.code === 'NONCE_EXPIRED') {
      // Extract and handle the error reason
      // console.log("Error reason:", error.reason);
      return 0;
    } else {
      console.error("The ", error);
      return 0;
    }
  }
};

// Function to verify the ID (Batch) with Smart Contract with Retry
const verifyBatchCertificationWithRetry = async (batchNumber, dataHash, proof, hashProof, retryCount = 3) => {
  try {
    // Blockchain processing.
    let batchVerifyResponse = await newContract.verifyBatchCertification(batchNumber, dataHash, proof);
    let _responseStatus = await newContract.verifyCertificateInBatch(hashProof);
    let responseStatus = parseInt(_responseStatus);

    if (batchVerifyResponse) {
      if (responseStatus) {
        if (responseStatus == 3) {
          return 3;
        }
      }
      if (responseStatus == 5) {
        return 2;
      }
      return 1;
    }
    return 0;
  } catch (error) {
    if (retryCount > 0 && error.code === 'ETIMEDOUT') {
      console.log(`Connection timed out. Retrying... Attempts left: ${retryCount}`);
      // Retry after a delay (e.g., 2 seconds)
      await holdExecution(2000);
      return verifyBatchCertificationWithRetry(batchNumber, dataHash, proof, hashProof, retryCount - 1);
    } else if (error.code === 'NONCE_EXPIRED') {
      // Extract and handle the error reason
      // console.log("Error reason:", error.reason);
      return 0;
    } else {
      console.error("The ", error);
      return 0;
    }
  }
};

module.exports = {
  // Function to verify a certificate with a PDF QR code
  verify,

  // Function to verify a Single/Batch certification with an ID
  verifyCertificationId,

  // Function to decode a certificate
  decodeCertificate,

  // Function to verify a certificate with a Scanned Short url/Original url based QR code
  decodeQRScan
};