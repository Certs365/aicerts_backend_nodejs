require('dotenv').config();
const express = require("express");
const app = express();
const path = require("path");
const QRCode = require("qrcode");
const fs = require("fs");

const Web3 = require('web3');
// mongodb admin model
const { Admin, User, Issues } = require("../config/schema");

// Password handler
const bcrypt = require("bcrypt");

const { insertCertificateData, extractQRCodeDataFromPDF, addLinkToPdf, calculateHash, web3i, confirm, simulateIssueCertificate, simulateTrustedOwner, cleanUploadFolder, isDBConncted } = require('../model/tasks');
let linkUrl;
let detailsQR;

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// API call for Certificate issue with pdf template
const issuePdf = async (req, res) => {
  const email = req.body.email;
  const Certificate_Number = req.body.certificateNumber;
  const name = req.body.name;
  const courseName = req.body.course;
  const Grant_Date = req.body.grantDate;
  const Expiration_Date = req.body.expirationDate;

  const idExist = await User.findOne({ email });

  if (!idExist || !Certificate_Number || !name || !courseName || !Grant_Date || !Expiration_Date) {
    res.status(400).json({ message: "Please provide valid details" });
    return;
  } else {
    const fields = {
    Certificate_Number: req.body.certificateNumber,
    name: req.body.name,
    courseName: req.body.course,
    Grant_Date: req.body.grantDate,
    Expiration_Date: req.body.expirationDate,
  };
  const hashedFields = {};
  for (const field in fields) {
    hashedFields[field] = calculateHash(fields[field]);
  }
  const combinedHash = calculateHash(JSON.stringify(hashedFields));

  //Blockchain processing.
  const contract = await web3i();    

    const val = await contract.methods.verifyCertificate(combinedHash).call();

      if (val[0] == true && val[1] == Certificate_Number) {
        res.status(400).json({ message: "Certificate already issued" });
      } 
      else {
        const simulateIssue = await simulateIssueCertificate(Certificate_Number, combinedHash);
      if (simulateIssue) { 
        const tx = contract.methods.issueCertificate(
          fields.Certificate_Number,
          combinedHash
        );
        const hash = await confirm(tx);

      const linkUrl = `https://${process.env.NETWORK}.com/tx/${hash}`;
          
          const qrCodeData =
`Verify On Blockchain: ${linkUrl},
Certification Number: ${Certificate_Number},
Name: ${name},
Certification Name: ${courseName},
Grant Date: ${Grant_Date},
Expiration Date: ${Expiration_Date}`;

      const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
        errorCorrectionLevel: "H",
      });

        file = req.file.path;
        const outputPdf = `${fields.Certificate_Number}${name}.pdf`;
        // linkUrl = `https://${process.env.NETWORK}.com/tx/${hash}`;

        const opdf = await addLinkToPdf(
          // __dirname + "/" + file,
          path.join(__dirname, '..', file),
          outputPdf,
          linkUrl,
          qrCodeImage,
          combinedHash
        );
    
        const fileBuffer = fs.readFileSync(outputPdf);

        try {
          // Check mongoose connection
          const dbState = await isDBConncted();
          if (dbState === false) {
            console.error("Database connection is not ready");
          } else {
            console.log("Database connection is ready");
          }

          const id = idExist.id;

          const certificateData = {
            id,
            transactionHash: hash,
            certificateHash: combinedHash,
            certificateNumber: fields.Certificate_Number,
            name: fields.name,
            course: fields.courseName,
            grantDate: fields.Grant_Date,
            expirationDate: fields.Expiration_Date
          };
          await insertCertificateData(certificateData);
      
          const certificateName = `${fields.Certificate_Number}_certificate.pdf`;

          res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${certificateName}"`,
          });
          res.send(fileBuffer);

          // Delete files
          if (fs.existsSync(outputPdf)) {
            // Delete the specified file
            fs.unlinkSync(outputPdf);
          } 
          
          // Always delete the temporary file (if it exists)
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
          }

          await cleanUploadFolder();
          
        }catch (error) {
          // Handle mongoose connection error (log it, throw an error, etc.)
          console.error("Internal server error", error);
        }
                
      }
      else {
        res.status(400).json({ message: "Simulation for the IssueCertificate failed" });
      }
    }
  }
};

// API call for Certificate issue without pdf template
const issue = async (req, res) => {
  const email = req.body.email;
  const Certificate_Number = req.body.certificateNumber;
  const name = req.body.name;
  const courseName = req.body.course;
  const Grant_Date = req.body.grantDate;
  const Expiration_Date = req.body.expirationDate;

  const idExist = await User.findOne({ email });
  
  if (!idExist || !Certificate_Number || !name || !courseName || !Grant_Date || !Expiration_Date || [Certificate_Number, name, courseName, Grant_Date, Expiration_Date].some(value => typeof value !== 'string' || value == 'string')) {
    res.status(400).json({ message: "Please fill all the fields with valid details" });
    return;
  } else {
    try {
      const fields = {
        Certificate_Number: Certificate_Number,
        name: name,
        courseName: courseName,
        Grant_Date: Grant_Date,
        Expiration_Date: Expiration_Date,
      };
      const hashedFields = {};
      for (const field in fields) {
        hashedFields[field] = calculateHash(fields[field]);
      }
      const combinedHash = calculateHash(JSON.stringify(hashedFields));

      // Blockchain processing.
      const contract = await web3i();

      const val = await contract.methods.verifyCertificate(combinedHash).call();

      if (val[0] == true && val[1] == Certificate_Number) {
        res.status(400).json({ message: "Certificate already issued" });
      } else {
        const simulateIssue = await simulateIssueCertificate(Certificate_Number, combinedHash);
        if (simulateIssue) {
          const tx = contract.methods.issueCertificate(
            Certificate_Number,
            combinedHash
          );

          hash = await confirm(tx);

      const polygonLink = `https://${process.env.NETWORK}.com/tx/${hash}`;
          
          const qrCodeData =
`Verify On Blockchain: ${polygonLink},
Certification Number: ${Certificate_Number},
Name: ${name},
Certification Name: ${courseName},
Grant Date: ${Grant_Date},
Expiration Date: ${Expiration_Date}`;

      const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
        errorCorrectionLevel: "H",
      });


        try {
          // Check mongoose connection
          const dbState = await isDBConncted();
          if (dbState === false) {
            console.error("Database connection is not ready");
          } else {
            console.log("Database connection is ready");
          }

          const id = idExist.id;

          var certificateData = {
            id,
            transactionHash: hash,
            certificateHash: combinedHash,
            certificateNumber: Certificate_Number,
            name: name,
            course: courseName,
            grantDate: Grant_Date,
            expirationDate: Expiration_Date
          };

          await insertCertificateData(certificateData);

          }catch (error) {
          // Handle mongoose connection error (log it, throw an error, etc.)
          console.error("Internal server error", error);
        }

          res.status(200).json({
            message: "Certificate issued successfully",
            qrCodeImage: qrCodeImage,
            polygonLink: polygonLink,
            details: certificateData,
          });
        }
        else {
          res.status(400).json({ message: "Simulation for the IssueCertificate failed" });
        }
      }

    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
};

// Define a route that takes a hash parameter
const polygonLink = async (req, res) => {
  res.json({ linkUrl });
};

// Verify page
const verify = async (req, res) => {
  file = req.file.path;
  try {
    var certificateData = await extractQRCodeDataFromPDF(file);

    const contract = await web3i();
    const certificateNumber = certificateData["Certificate Number"];
    const val = await contract.methods
      .verifyCertificate(certificateData["Certificate Hash"])
      .call();

    const isCertificateValid = val[0] == true && val[1] == certificateNumber;
    const message = isCertificateValid ? "Verified: Certificate is valid" : "Certificate is not valid";

    const verificationResponse = {
      message: message,
      detailsQR: certificateData
    };

    res.status(isCertificateValid ? 200 : 400).json(verificationResponse);
  } catch (error) {
    const verificationResponse = {
      message: "Certificate is not valid"
    };

    res.status(400).json(verificationResponse);
  }
  
  // Delete files
  if (fs.existsSync(file)) {
     fs.unlinkSync(file);
  }

  await cleanUploadFolder();
          
};

const verifyWithHash = async (req, res) => {
  inputHash = req.body.hash;
  try {
    // Blockchain processing.
    const contract = await web3i();
    const response = await contract.methods.verifyCertificate(inputHash).call();

    if (response[0] == true) {
      const certificateNumber = response[1];
    try {
          // Check mongoose connection
          const dbState = await isDBConncted();
          if (dbState === false) {
            console.error("Database connection is not ready");
          } else {
            console.log("Database connection is ready");
          }
      var certificateExist = await Issues.findOne({ certificateNumber });
      if(certificateExist) {
      var isCertificateValid = response[0] == true && response[1] == certificateExist.certificateNumber;
      } else {
        isCertificateValid = false;
      }
      const message = isCertificateValid ? "Verified: Certificate details available" : "Certificate details not available";

      const verificationResponse = {
        message: message,
        details: (isCertificateValid) ? certificateExist : certificateNumber
      };
      res.status(200).json(verificationResponse);
      
      }catch (error) {
          console.error("Internal server error", error);
      }
    } else {
      res.status(400).json({ message: "Certificate doesn't exist" });
    }
  } catch (error) {
    const verificationResponse = {
      message: "Certificate is not valid"
    };
    res.status(400).json(verificationResponse);
  }   
};

const verifyWithId = async (req, res) => {
  inputId = req.body.id;

  try {
    // Blockchain processing.
    const contract = await web3i();
    const response = await contract.methods.verifyCertificateById(inputId).call();

    if (response === true) {
      const certificateNumber = inputId;
    try {
          // Check mongoose connection
          const dbState = await isDBConncted();
          if (dbState === false) {
            console.error("Database connection is not ready");
          } else {
            console.log("Database connection is ready");
          }
      var certificateExist = await Issues.findOne({ certificateNumber });
      if(certificateExist) {
      var isCertificateValid = response[0] == true && response[1] == certificateExist.certificateNumber;
      } else {
        isCertificateValid = false;
      }
      const message = isCertificateValid ? "Verified: Certificate details available" : "Certificate details not available";

      const verificationResponse = {
        message: message,
        details: (isCertificateValid) ? certificateExist : certificateNumber
      };
      res.status(200).json(verificationResponse);
      
      }catch (error) {
          console.error("Internal server error", error);
      }
    } else {
      res.status(400).json({ status: "FAILED", message: "Certificate doesn't exist" });
    }
  } catch (error) {
    res.status(500).json({
      status: "FAILED",
      message: error,
    });
  } 

};

// Admin Signup
const signup = async (req, res) => {
  let { name, email, password } = req.body;
  name = name.trim();
  email = email.trim();
  password = password.trim();

  if (name == "" || email == "" || password == "") {
    res.json({
      status: "FAILED",
      message: "Empty input fields!",
    });
  } else if (!/^[a-zA-Z ]*$/.test(name)) {
    res.json({
      status: "FAILED",
      message: "Invalid name entered",
    });
  } else if (!/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email)) {
    res.json({
      status: "FAILED",
      message: "Invalid email entered",
    });
  } else if (password.length < 8) {
    res.json({
      status: "FAILED",
      message: "Password is too short!",
    });
  } else {
    try {
      // Check mongoose connection
      const dbState = await isDBConncted();
      if (dbState === false) {
        console.error("Database connection is not ready");
      } else {
        console.log("Database connection is ready");
      }
      // Checking if Admin already exists
      const existingAdmin = await Admin.findOne({ email });

      if (existingAdmin) {
        res.json({
          status: "FAILED",
          message: "Admin with the provided email already exists",
        });
        return; // Stop execution if user already exists
      }

       // password handling
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Save new user
      const newAdmin = new Admin({
        name,
        email,
        password: hashedPassword,
        status: false
      });

      const savedAdmin = await newAdmin.save();
      res.json({
        status: "SUCCESS",
        message: "Signup successful",
        data: savedAdmin,
      });
    } catch (error) {
      res.json({
        status: "FAILED",
        message: "An error occurred",
      });
    }  
  }
};

// Admin Login
const login = async (req, res) => {
  let { email, password } = req.body;

  if (email == "" || password == "") {
    res.json({
      status: "FAILED",
      message: "Empty credentials supplied",
    });
  } else {
    // Check mongoose connection
      const dbState = await isDBConncted();
      if (dbState === false) {
        console.error("Database connection is not ready");
      } else {
        console.log("Database connection is ready");
    }
    
    // Checking if user exists 
    const adminExist = await Admin.findOne({ email });
    Admin.find({ email })
      .then((data) => {
        if (data.length) {
          
          // User exists
          const hashedPassword = data[0].password;
          bcrypt
            .compare(password, hashedPassword)
            .then((result) => {
              if (result) {
                // Save verification details
                adminExist.status = true;
                adminExist.save();
                // Password match
                res.status(200).json({
                  status: "SUCCESS",
                  message: "Valid User Credentials",
                });
              } else {
                res.json({
                  status: "FAILED",
                  message: "Invalid password entered!",
                });
              }
            })
            .catch((err) => {
              res.json({
                status: "FAILED",
                message: "An error occurred while comparing passwords",
              });
            });
          
        } else {
          res.json({
            status: "FAILED",
            message: "Invalid credentials entered!",
          });
        }
      })
      .catch((err) => {
        res.json({
          status: "FAILED",
          message: "An error occurred while checking for existing user",
        });
      });
  }
};

const logout = async (req, res) => {
  let { email } = req.body;
  try {
    // Check mongoose connection
      const dbState = await isDBConncted();
      if (dbState === false) {
        console.error("Database connection is not ready");
      } else {
        console.log("Database connection is ready");
      }
    // Checking if Admin already exists
    const existingAdmin = await Admin.findOne({ email });
    
    if (!existingAdmin) {
      return res.json({
        status: 'FAILED',
        message: 'Admin not found (or) Not Logged in!',
      });

    }
    // Save logout details
    existingAdmin.status = false;
    existingAdmin.save();

    res.json({
        status: "SUCCESS",
        message: "Admin Logged out successfully"
     });

  } catch (error) {
    res.json({
      status: 'FAILED',
      message: 'An error occurred during the logout!',
    });
  }
};

const resetPassword = async (req, res) => {
  let { email, password } = req.body;
  try {
    // Check mongoose connection
      const dbState = await isDBConncted();
      if (dbState === false) {
        console.error("Database connection is not ready");
      } else {
        console.log("Database connection is ready");
    }
    
    const admin = await Admin.findOne({ email });

    if (!admin) {
      return res.json({
        status: 'FAILED',
        message: 'Admin not found',
      });
    }
    // password handling
    const saltRounds = 10;
            bcrypt
              .hash(password, saltRounds)
              .then((hashedPassword) => {
                admin.password = hashedPassword;
                admin
                  .save()
                  .then(() => {
                    res.json({
                      status: "SUCCESS",
                      message: "Password reset successful"
                    });
                  })
                  .catch((err) => {
                    res.json({
                      status: "FAILED",
                      message: "An error occurred while saving user account!",
                    });
                  });
              })
              .catch((err) => {
                res.json({
                  status: "FAILED",
                  message: "An error occurred while hashing password!",
                });
              });

  } catch (error) {
    res.json({
      status: 'FAILED',
      message: 'An error occurred during password reset process!',
    });
  }
};

const getAllIssuers = async (req, res) => {
  try {
    // Check mongoose connection
      const dbState = await isDBConncted();
      if (dbState === false) {
        console.error("Database connection is not ready");
      } else {
        console.log("Database connection is ready");
    }
    
    const allIssuers = await User.find({});
    res.json({
      status: 'SUCCESS',
      data: allIssuers,
      message: 'All user details fetched successfully'
    });
  } catch (error) {
    res.json({
      status: 'FAILED',
      message: 'An error occurred while fetching user details'
    });
  }
};

const approveIssuer = async (req, res) => {
  let { email } = req.body;
  try {
    // Check mongoose connection
      const dbState = await isDBConncted();
      if (dbState === false) {
        console.error("Database connection is not ready");
      } else {
        console.log("Database connection is ready");
    }
    
    const user = await User.findOne({ email });
    if (!user || user.approved) {
      return res.json({
        status: 'FAILED',
        message: 'User not found (or) User Approved!',
      });

    }

    // Save verification details
    user.approved = true;
    user.save();

    res.json({
        status: "SUCCESS",
        message: "User Approved successfully"
     });

  } catch (error) {
    res.json({
      status: 'FAILED',
      message: 'An error occurred during password reset process!',
    });
  }
};

const addTrustedOwner = async (req, res) => {
  const web3 = await new Web3(
    new Web3.providers.HttpProvider(
      process.env.RPC_ENDPOINT
    )
  );
  // const { newOwnerAddress } = req.body;
  try {
    const newOwnerAddress = req.body.address;

    if (!web3.utils.isAddress(newOwnerAddress)) {
      return res.status(400).json({ message: "Invalid Ethereum address format" });
    }

    const simulateOwner = await simulateTrustedOwner(addTrustedOwner, newOwnerAddress);

    if (simulateOwner) {
      const contract = await web3i();

      const tx = contract.methods.addTrustedOwner(newOwnerAddress);

      const hash = await confirm(tx);

      const responseMessage = {
        message: "Trusted owner added successfully",
      };

      res.status(200).json(responseMessage);
    } else {
      return res.status(400).json({ message: "Simulation failed" });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const removeTrustedOwner = async (req, res) => {
  const web3 = await new Web3(
    new Web3.providers.HttpProvider(
      process.env.RPC_ENDPOINT
    )
  );
  // const { ownerToRemove } = req.body;
  try {
    const ownerToRemove = req.body.address;

    if (!web3.utils.isAddress(ownerToRemove)) {
      return res.status(400).json({ message: "Invalid Ethereum address format" });
    }

    const simulateOwner = await simulateTrustedOwner(removeTrustedOwner, ownerToRemove);
    
    if (simulateOwner) {

    const contract = await web3i();

    const tx = contract.methods.removeTrustedOwner(ownerToRemove);

    const hash = await confirm(tx);

    const responseMessage = {
      message: "Trusted owner removed successfully",
    };

      res.status(200).json(responseMessage);
      } else {
      return res.status(400).json({ message: "Simulation failed" });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const checkBalance = async (req, res) => {
  const web3 = await new Web3(
    new Web3.providers.HttpProvider(
      process.env.RPC_ENDPOINT
    )
  );
  try {
      const targetAddress = req.query.address;
      if (!web3.utils.isAddress(targetAddress)) {
          return res.status(400).json({ message: "Invalid Ethereum address format" });
      }

      const balanceWei = await web3.eth.getBalance(targetAddress);
    const balanceEther = web3.utils.fromWei(balanceWei, 'ether');
    
    // Convert balanceEther to fixed number of decimals (e.g., 2 decimals)
    const fixedDecimals = parseFloat(balanceEther).toFixed(3);

      const balanceResponse = {
          message: "Balance check successful",
          balance: fixedDecimals,
      };

      res.status(200).json(balanceResponse);
  } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
  }
};

module.exports = {
  issuePdf,
  issue,
  polygonLink,
  verify,
  verifyWithHash,
  verifyWithId,
  signup,
  login,
  logout,
  resetPassword,
  getAllIssuers,
  approveIssuer,
  addTrustedOwner,
  removeTrustedOwner,
  checkBalance
}