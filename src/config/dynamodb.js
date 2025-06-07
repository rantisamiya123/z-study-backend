const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const {
  env
} = require("../config/environment");

const config = {
  region: env.AWS_REGION || 'ap-southeast-1',
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  }
};

// Jika ada endpoint (untuk DynamoDB Local)
// if (env.DYNAMODB_ENDPOINT) {
//   config.endpoint = process.env.DYNAMODB_ENDPOINT;
// }

const client = new DynamoDBClient(config);
const docClient = DynamoDBDocumentClient.from(client);

module.exports = { client, docClient };