// Load environment variables from a .env file into process.env
require('dotenv').config();

// Import the mongoose library for MongoDB interaction
const mongoose = require("mongoose");

const utils = require('./utils.js');

// Connect to MongoDB using the MONGODB_URI environment variable
mongoose
  .connect(utils.MONGODB_URI)
  .then(() => {
    console.log("DB Connected"); // Log a message when the connection is successful
  })
  .catch((err) => console.log(err)); // Log an error if the connection fails
