// queueUtils.js
const Redis = require("ioredis");


const processBulkExcelJobs = require("./bulkIssueExcelQueueProcessor")

const processExcelJob = async (job) => {
  try {
    const { chunk, rows, batchId } = job.data;
    const result = await processBulkExcelJobs(chunk, rows, job.id);

    // If the result status is FAILED, return an error object
    if (result.status === "FAILED") {
      return {
        status: "FAILED",
        response: false,
        message: result.message,
        Details: result.Details || "", // Ensure this is properly set
      };
    }

    // If the result is successful, return success
    return {
      status: 200,
      response: true,
      message: "Job processed successfully",
    };
  } catch (error) {
    // Return error information instead of throwing
    return {
      status: 500,
      response: false,
      message: "An error occurred while processing the job.",
      Details: `${error.message || ''} ${error.Details || ''}`,
    };
  }
};

// Add jobs to queue in chunks with error handling
async function addJobsInChunks(queue, data, chunkSize, jobDataCallback) {
  const jobs = [];
  try {
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const jobData = jobDataCallback ? jobDataCallback(chunk) : chunk; // Use callback or default to chunk
      // Add job to the queue
      const job = await queue.add(jobData, { attempts: 2 });
      console.log("job added to bulkIssue Queue", i)
      jobs.push(job);
    }
    return jobs;
  } catch (error) {
    console.error("Error adding jobs in chunks:", error.message);
    throw {
      status: 400,
      response: false,
      message: "Failed to add jobs in chunks",
      details: error.message,
    };
  }
}

async function cleanUpJobs(queue) {
  console.log("The job deletion log for I name:", queue.name);
  try {
    // Clean completed and failed jobs immediately
    await queue.clean(0, 'completed');
    await queue.clean(0, 'failed');

  } catch (error) {
    console.error('Error during job cleanup:', error);
  } finally {
    try {
      // Obliterate the queue, removing all associated Redis data
      await queue.obliterate({ force: true });  // 'force: true' ensures the queue is removed even with active jobs
      console.log('Queue data deleted from Redis');
    } catch (error) {
      console.error('Error during queue obliteration:', error);
    } finally {
      // Close the queue to prevent new jobs from being added
      // await queue.close(); 
      console.log('Queue closed');
    }
  }
};

async function cleanUpStalledCheck(queueName) {
  const redis = new Redis(); // Defaults to localhost:6379; configure if needed
  try {
    // Define the stalled-check key pattern based on queue name
    const keyPattern = `bull:${queueName}:stalled-check`;
    console.log("the key pattern", keyPattern);
    // Find matching keys (like stalled-check)
    const keys = await redis.keys(keyPattern);

    if (keys.length > 0) {
      // Delete all keys that match the pattern
      await Promise.all(keys.map(key => redis.del(key)));
      console.log(`Deleted stalled-check keys for queue: ${queueName}`);
    } else {
      console.log(`No stalled-check keys found for queue: ${queueName}`);
    }
  } catch (error) {
    console.error("Error deleting stalled-check keys:", error);
  } finally {
    await redis.disconnect();
  }
}

async function _cleanUpJobs(queue, jobId) {
  console.log("The job deletion log for ID:", jobId);
  try {
    // Fetch completed jobs and selectively remove the specific job
    const completedJobs = await queue.getJobs(['completed']);
    for (const job of completedJobs) {
      if (job.id === jobId) {
        await job.remove();
        console.log(`Completed job ${job.id} removed`);
      }
    }

    // Fetch failed jobs and selectively remove the specific job
    const failedJobs = await queue.getJobs(['failed']);
    for (const job of failedJobs) {
      if (job.id === jobId) {
        await job.remove();
        console.log(`Failed job ${job.id} removed`);
      }
    }

  } catch (error) {
    console.error('Error during selective job cleanup:', error);
  } finally {
    console.log('Selective cleanup completed for specific job');
  }
}



// Wait for all jobs to complete with error handling
const waitForJobsToComplete = async (jobs) => {
  try {
    const results = await Promise.all(
      jobs.map((job) =>
        job.finished().catch((err) => {
          console.error("Job failed:", err);
          throw {
            status: 500,
            response: false,
            message: "Job failed to complete",
            details: err.message || err,
          };
        })
      )
    );

    // Extract all URLS from the results
    const allUrls = results.flatMap((result) => {
      console.log(result.URLS)
      return result.URLS
    });
    return allUrls; // Return the aggregated URLs
  } catch (error) {
    console.error("Error waiting for jobs to complete:", error.message);
    throw {
      status: 500,
      response: false,
      message: "Failed to wait for jobs to complete",
      details: error.message,
    };
  }
};
const getChunkSizeAndConcurrency = (count) => {
  if (count <= 100) {
    return { chunkSize: 10, concurrency: 10 };
  } else if (count <= 500) {
    return { chunkSize: 25, concurrency: 15 };
  } else if (count <= 2000) {
    return { chunkSize: 50, concurrency: 20 };
  } else if (count <= 5000) {
    return { chunkSize: 100, concurrency: 25 };
  } else {
    return { chunkSize: 200, concurrency: 30 };
  }
};



const cleanRedis = async (redisConfig) => {
  const redisClient = new Redis(redisConfig.redis.port, redisConfig.redis.host);

  try {
    await redisClient.flushdb(); // Clears the current database
    console.log('Redis database cleaned successfully.');
  } catch (error) {
    console.error('Error cleaning Redis database:', error);
  } finally {
    redisClient.quit(); // Ensure the Redis client is closed after operation
  }
};

const globalStore = {
  pdfWidth: null,
  pdfHeight: null,
  linkUrl: null,
  qrside: null,
  posx: null,
  posy: null,
  excelResponse: null,
  hashedBatchData: null,
  serializedTree: null,
  email: null,
  issuerId: null,
  allocateBatchId: null,
  txHash: null,
  bulkIssueStatus: null,
  flag: null,
  customFolder: null,
  qrOption: null,
};

const setGlobalDataforQueue = (data) => {
  Object.assign(globalStore, data);

}
const getGlobalDataforQueue = () => globalStore




module.exports = {
  addJobsInChunks,
  waitForJobsToComplete,
  cleanUpJobs,
  _cleanUpJobs,
  processExcelJob,
  getChunkSizeAndConcurrency,
  cleanRedis,
  setGlobalDataforQueue,
  getGlobalDataforQueue
};
