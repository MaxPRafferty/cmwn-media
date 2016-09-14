var exports = module.exports = {};
var AWS = require('aws-sdk');

AWS.config.loadFromPath('../conf/src/aws.json');
var docClient = new AWS.DynamoDB.DocumentClient();

exports.load = function (env, callback) {
    'use strict';
    var params = {
        TableName: 'box_oauth',
        Key: {
            'env': env
        }
    };

    docClient.get(params, callback);
};

exports.save = function (env, data, callback) {
    'use strict';
    var params = {
        TableName: 'box_oauth',
        Item: {
            'env': env,
            'data': data
        }
    };

    docClient.put(params, callback);
};

