var exports = module.exports = {};
var _ = require('lodash');
//var Log = require('log');
//var log = new Log();
var config = require('./intelligence_bank_config.json');
//var config = require('./config.json');
//var env = config.env;
var anyFirst = require('promise-any-first');

var AWS = require('aws-sdk');
AWS.config.loadFromPath('./src/aws.json');
var docClient = new AWS.DynamoDB.DocumentClient();

var IntelligenceBank = require('./intelligence_bank_client.js');

const IB_API_URL = 'https://apius.intelligencebank.com';

var transformFolderToExpected = function (resourceLocationUrl, folderId, data) {
    var transformed = data;
    transformed.items = [];
    delete transformed.folderuuid;
    /* eslint-disable camelcase */
    transformed.asset_type = 'folder';
    transformed.media_id = folderId;
    /* eslint-enable camelcase */
    transformed.type = 'folder';
    transformed.created = data.createdtime;
    delete transformed.createdtime;
    console.log('items: ' + JSON.stringify(transformed.items));
    console.log('resource: ' + JSON.stringify(transformed.resource));
    transformed.items = transformed.items.concat(_.map(data.resource || [], function (item) {
        return transformResourceToExpected(resourceLocationUrl, item);
    }));
    delete transformed.resource;
    console.log('items: ' + JSON.stringify(transformed.items));
    console.log('folder: ' + JSON.stringify(transformed.folder));
    transformed.items = transformed.items.concat(_.map(data.folder, function (item) {
        return transformFolderToExpected(resourceLocationUrl, item.folderuuid, item);
    }));
    delete transformed.folder;
    return transformed;
};

var transformResourceToExpected = function (resourceLocationUrl, data) {
    var transformed = data;
    transformed.type = 'file';
    //no hash currently being returned. hmmmmmm
    transformed.check = {
        type: null,
        value: null
    };
    /* eslint-disable camelcase */
    transformed.media_id = data.uuid;
    //nor mime type. double hmmmm
    transformed.mime_type = null;
    /* eslint-enable camelcase */
    delete transformed.resourceuuid;
    transformed.name = data.title;
    transformed.src = resourceLocationUrl + transformed.media_id;
    transformed.thumb = resourceLocationUrl + transformed.media_id + '&compressiontype=2&size=25';

    data.tags = data.tags || [];

    //data.tags.forEach(tag => {
    //    if (tag.indexOf('asset_type') === 0) {
    //        transformed.asset_type = tag.split('-')[1]; // eslint-disable-line camelcase
    //    } else if (~tag.indexOf(':')) {
    //        transformed[tag.split(':')[0]] = tag.split(':')[1];
    //    } else {
    //        transformed[tag] = true; // eslint-disable-line camelcase
    //    }
    //});

    return transformed;
};

var ibClient = new IntelligenceBank({
    baseUrl: IB_API_URL,
    //log: Log,
    transformFolder: transformFolderToExpected,
    transformAsset: transformResourceToExpected
});


exports.init = function () {
    'use strict';

//    docClient.get({
//        TableName: 'intelligence_bank_keys',
//        Key: {
//            'key_name': 'apikey'
//        }
//    }, function (err, data) {
//        if (err || !Object.keys(data).length) {
            console.log('manually retrieving keys');
            ibClient.connect({
                username: config.username,
                password: config.password,
                instanceUrl: config.instanceUrl,
                ownUrl: config.host,
                onConnect: function (data_) {
                    //store in dynamo
                    docClient.put({TableName: 'intelligence_bank_keys', Item: {
                        'key_name': 'apikey',
                        useruuid: data_.useruuid,
                        apikey: data_.apikey
                    }}, function (err_) {
                        if (err_) {
                            console.error('cache store failed: ' + err_);
                        }
                    });
                }
            });
//        } else {
//            console.log('retrieving stored key');
//            ibClient.connect({
//                apikey: data.Item.apikey,
//                useruuid: data.Item.useruuid
//            });
//        }
//    });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAssetInfo = function (assetId, r) {
    console.log('getting asset');
    docClient.get({
        TableName: 'intelligence_bank_cache',
        Key: {
            'id': assetId
        }
    }, function (err, data) {
        if (err || !Object.keys(data).length) {
            console.log('manually retrieving folder');
            //we do not know at this point if we have a folder or an asset. The only way to know
            //is to check both. One call will always fail, one will always succeed.
            anyFirst([ibClient.getAssetInfo({id: assetId}), ibClient.getFolderInfo({id: assetId})])
                .then(function (data_) {
                    console.log('caching asset: ' + JSON.stringify(data_));
                    //store in dynamo
                    //docClient.put({TableName: 'intelligence_bank_cache', Item: data_}, function (err_) {
                    //    if (err_) {
                    //        console.error('cache store failed: ' + err_);
                    //    }
                    //});
                    r(data_);
                })
                .catch(function (err_) {
                    console.log('Could not retrieve asset ' + err_);
                    r('ERROR: 500. Details: ' + err_);
                });
        } else {
            console.log('asset cache hit');
            r(data.Item);
        }
    });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAsset = function (assetId, r) {
    'use strict';
    r({url: ibClient.getAssetUrl(assetId)});
};
