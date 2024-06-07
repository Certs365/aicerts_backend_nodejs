module.exports = {

    // Tasks Messages
    msgDbReady: "Database connection is Ready",
    msgDbNotReady : "Database connection is Not Ready",
    
    // Response code messages
    msgInternalError : "Internal server error",
    msgWorkInProgress: "🚧 !⚠! Work In Porgress !⚠! 🚧",

    // Handle Excel File messages
    msgInvalidExcel : "Invalid Excel file, Please try again",
    msgExcelLimit : "Application can support upto 250 (Excel file should have 250 certifications maximum)",
    msgInvalidCertIds : "Excel file has invalid certification IDs length (each: min 12 - max 20)",
    msgExcelRepetetionIds : "Excel file has repetition in certification IDs",
    msgInvalidDateFormat: "File has invalid Date format",
    msgInvalidDates: "File has invalid Dates",
    msgInvalidGrantDate: "File has invalid Grant Date format",
    msgInvalidExpirationDate: "File has invalid Expiration Date format",
    msgOlderDateThanNewDate : "File has Future grant date than Expiration Date",
    msgExcelHasExistingIds : "Excel file has Existing Certification IDs",
    msgInvalidHeaders : "Invalid headers in the Excel file.",
    msgExcelSheetname : "The Excel file Sheet name should be - Batch.",
    msgMissingDetailsInExcel : "The Excel file has missing fields, Please fill all required fields and try again",
    msgFailedToIssueAfterRetry : "Failed to issue certification after retries. Please try again...",
    msgFailedToGrantRoleRetry : "Failed to Grant Role after retries. Please try again...",
    msgFailedToRevokeRoleRetry : "Failed to Revoke Role after retries. Please try again...",
    msgFailedToUpdateStatusRetry : "Failed to Update status after retries. Please try again...",
    msgFailedToRenewRetry : "Failed to Extend expiration after retries. Please try again...",


    // Validation Error codes Issues (Route)
    msgInvalidFile : "Invalid file uploaded / Please Try again ...",
    msgEnterInvalid : "Entered invalid input / Please check and try again...",
    msgInvalidEmail: "Entered invalid Email",
    msgNonEmpty : "Input field cannot be empty",
    msgInputProvide : "Input should be provided",
    msgInvalidFormat : "Entered input format is invalid ",
    msgInvalidDate : "Entered date format is invalid",
    msgCertLength : "Certification ID must between 12 to 20 characters",
    msgMaxLength : "Entered Input must between 8 to 30 characters",
    msgMaxLengthCourse : "Entered Input must not exceed 150 characters",

    // API response codes in Issues (Controller)
    msgAuthMissing : "Authorization token is missing",
    msgTokenExpired : "Authorization token has expired",
    msgInvalidToken : "Provided invalid Token",
    msgInvalidKey : "Please provide valid key to validate token",
    msgInvalidFilePath : "Provided invalid file path",
    msgMustPdf : "Must upload PDF file format",
    msgMustExcel : "Must upload Excel file format",
    msgPlsEnterValid : "Please provide valid details",
    msgInvalidIssuer : "Invalid Issuer email",
    msgCertIdRequired : "Certification ID is required",
    msgUnauthIssuer : "Unauthorised Issuer Email",
    msgProvideValidDates : "Please provide valid dates",
    msgInvalidEthereum : "Invalid Ethereum address format",
    msgCertIssuedSuccess : "Certification issued successfully",
    msgBatchIssuedSuccess: "Batch of Certifications issued successfully",
    msgInvalidPdfTemplate : "Invalid PDF (Certification Template) dimensions",
    msgCertIssued : "Certification ID already issued",
    msgOpsRestricted : "Operation restricted by the Blockchain",
    msgIssuerUnauthrized : "Unauthorized Issuer to perform operation on Blockchain",
    msgFailedAtBlockchain : "Failed to interact with Blockchain / Please Try again ...",
    msgFailedOpsAtBlockchain : "Failed to perform opertaion at Blockchain / Please Try again ...",
    msgMultiPagePdf : "Multiple Pages PDF document is not allowed, Please try again with valid single page PDF...",

    // Admin controller messages
    msgAdminMailExist : "Admin with the provided email already exists",
    msgSignupSuccess : "Signup successful",
    msgValidCredentials: "Provided valid credentials",
    msgInvalidCredentials : "Provided invalid credentials!",
    msgInvalidPassword : "Invalid password entered!",
    msgErrorOnPwdCompare : "An error occurred while comparing passwords",
    msgErrorOnExistUser : "An error occurred while checking for existing user",
    msgAdminNotFound : "Admin not found (or) Not Logged in!",
    msgLogoutSuccess : "Admin Logged out successfully",
    msgErrorInLogout : "An error occurred during the logout!",
    msgPwdSuccess : "Password reset successful",
    msgErrorOnUser : "An error occurred while saving user account!",
    msgErrorOnHashing : "An error occurred while hashing password!",
    msgErrorOnPwdReset : "An error occurred during password reset process!",
    msgCertNotValid: "Certification is not valid",
    msgCertValid: "Certification is Valid",
    msgCertNotExist : "Certification doesn't exist",
    msgCertValidNoDetails: "Certification is valid but No Details found",
    msgAllIssuersFetched : "All Issuer details fetched successfully",
    msgAllQueryFetched : "Requested details fetched successfully",
    msgErrorOnFetching : "An error occurred while fetching Issuer details",
    msgProvideValidStatus : "Please provide valid status as 1 : approve or 2 : reject",
    msgProvideValidCertStatus : "Please provide valid status",
    msgTypeRestricted: "Please provide valid type input (1, 2 or 3)",
    msgProvideValidType : "Please provide valid type as 1, 2 or 3",

    // Blockchain route Messages
    msgInvalidInput : "Invalid Input provided",
    msgUserNotFound : "Issuer not found!",
    msgNoMatchFound : "No matching results found",
    msgIssuerRejectSuccess : "Issuer Rejected successfully",
    msgExistRejectIssuer : "Existed Rejected Issuer",
    msgRejecetedAlready : "Issuer Rejected already",
    msgExistedVerified : "Existed Verified Issuer",
    msgIssuerApproveSuccess : "Issuer Approved successfully",
    msgIssueInValidation : "An error occurred during the Issuer validation process!",
    msgAddressExistBlockchain : "Address Existed in the Blockchain",
    msgAddressNotExistBlockchain : "Address Doesn't Existed in the Blockchain",
    msgAdminGrant : "Admin Role Granted",
    msgIssuerRoleGrant : "Issuer Role Granted",
    msgAdminRevoke : "Admin Role Revoked",
    msgIssuerRoleRevoke : "Issuer Role Revoked",
    msgBalanceCheck : "Balance check successful",
    msgNonZero : "Input must not zero or Negative",

    // Dates Messages
    msgInvalidDate : "Invalid Date, Please check and try again ...",
    msgInvalidDateFormat : "Please provide valid Date format",
    msgOlderGrantDate : "Expiration date must not older than Grant date, Please check and try again ...",
    msgInvalidExpiration : "Please provide valid expiration date or provide more than 30 days from today and try again...",
    msgInvalidNewExpiration : "Please provide valid newer expiration date or provide more than 30 days from today and try again...",
    msgUpdateExpirationNotPossible : "Extension of Expiration not possible on infinite Expiration certification",
    msgUpdateBatchExpirationNotPossible : "Extension of Batch Expiration not possible on infinite Expiration",
    
    //Renew/status update Messages
    msgCertBadRenewStatus : "Extend Expiration date not possible on the certification",
    msgEpirationMustGreater : "Please provide greater exipration date than existed expiration date",
    msgCertRenewedSuccess : "Certification expiration extended successfully",
    msgCommonBatchExpiration : "Batch of certification has common Expiration date",
    msgStatusAlreadyExist : "The certification status previously existed",
    msgBatchStatusRenened : "Batch expirataion renewed",
    msgBatchStatusUpdated : "Batch status updated",
    msgInvalidBatch : "Invalid batch details provided",
    msgBatchStatusUpdatedNotPossible : "Batch status updating operation not possible",
    msgOperationNotPossible : "Operation not possible on the certification",
    msgNotPossibleBatch : "Operation not possible on the Batch certification",
    msgReactivationNotPossible : "Certification must be revoked to perform Reactivation",
    msgNotPossibleOnRevoked : "Operation not possible on the Revoked certification",
    msgNotPossibleOnRevokedBatch : "Operation not possible on the Revoked Batch certification",
    msgInvalidRootPassed : "Invalid Batch certification value passed",
    msgBatchRenewed : "Batch Expiration date updated / Renewed",
    msgBatchExpired : "Provided Batch details were expired",
    msgCertExpired : "Provided Certification details were expired",
    msgRevokeNotPossible : "Operation not possible on provided Certification",

    // Verify certID/pdf Messages
    msgInvalidCert: "Invalid Certification",
    msgCertRevoked: "Certification has revoked",
    msgCertExpired: "Certification has expired",

    // Admin dashboard & Graph Analytics
    msgInvalidGraphInput: "Please provide valid Graph Input",
    msgUnableToGetGraphData: "Unable to fetched Graph data",
    msgGraphDataFetched: "Graph data fetched successfully",
    msgUserEmailNotFound: "Invalid email provided",
    msgDbError: "Unable to connect with Database, Please try again",
    msgIssueFound: "Certification details found",
    msgIssueNotFound: "Certification details not found",
    msgIssuerIdExist: "Issuer ID existed in Issuer Details",

    // URL shortening API
    msgInvalidUrl: "Please provide vaid URL",
    

};