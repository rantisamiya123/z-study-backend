const { CreateTableCommand } = require('@aws-sdk/client-dynamodb');
const { client } = require('../config/dynamodb');

const createUsersTable = async () => {
  const params = {
    TableName: `${process.env.DYNAMODB_TABLE_PREFIX}users`,
    KeySchema: [
      {
        AttributeName: 'userId',
        KeyType: 'HASH'
      }
    ],
    AttributeDefinitions: [
      {
        AttributeName: 'userId',
        AttributeType: 'S'
      },
      {
        AttributeName: 'email',
        AttributeType: 'S'
      },
      {
        AttributeName: 'googleId',
        AttributeType: 'S'
      }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'email-index',
        KeySchema: [
          {
            AttributeName: 'email',
            KeyType: 'HASH'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        BillingMode: 'PAY_PER_REQUEST'
      },
      {
        IndexName: 'googleId-index',
        KeySchema: [
          {
            AttributeName: 'googleId',
            KeyType: 'HASH'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  };

  try {
    const result = await client.send(new CreateTableCommand(params));
    console.log('Users table created successfully:', result);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log('Users table already exists');
    } else {
      console.error('Error creating users table:', error);
    }
  }
};

const createTables = async () => {
  await createUsersTable();
};

createTables();