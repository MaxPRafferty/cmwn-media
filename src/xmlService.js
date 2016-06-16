var fs = require('fs');
var xpath = require('xpath');
var DOMParser = require('xmldom').DOMParser;
var xmlString = fs.readFileSync(__dirname + '/api.xml');

console.log('Loading xml');
var doc = new DOMParser().parseFromString(xmlString.toString('utf8'), 'text/xml');
var exports = module.exports = {};

var boxSDK = require('box-sdk');

var logLevel = 'debug'; //default log level on construction is info

//Default host: localhost
var box = boxSDK.Box({
    'client_id': 'skhyf94wbjwcx0ax35b83mnwq01xtvrp',
    'client_secret': 'LRO7OVEGYd1qnjeU6BbobvLl29DvJGWr',
    port: 9999,
    // host: 'somehost' //default localhost
}, logLevel);

function convertRecordToObject(record) {
    'use strict';
    var asset = {};
    for (var childIdx in record.childNodes) {
        var node = record.childNodes[childIdx];
        var nodeName = node.nodeName;

        if (nodeName === undefined) {
            continue;
        }

        if (nodeName === '#text') {
            continue;
        }

        asset[nodeName] = node.childNodes[0].nodeValue;
    }

    return asset;
}

exports.getPage = function (srcUrl, page, perPage) {
    'use strict';
    page = parseInt(page, 10) || 1;
    perPage = parseInt(perPage, 10) || 10;
    var start = page * perPage;
    var end = start + perPage;

    var results = xpath.select('//item[position() > ' + start + ' and position() <= ' + end + ']', doc);
    var foundAssets = [];
    console.log('# results: ' + results.length);
    for (var idx in results) {
        var record = results[idx];

        var asset = convertRecordToObject(record);
        asset.src = srcUrl + asset.directory + '/' + asset.file_name;
        foundAssets.push(asset);
    }

    return foundAssets;
};

exports.getAsset = function (assetId) {
    'use strict';

    console.log('Finding Asset: ' + assetId);
    // var results = xpath.select('//item/asset_id[text()="' + assetId + '"]', doc);

    var connection = box.getConnection('admin@changemyworldnow.com');

    //Navigate user to the auth URL
    console.log(connection.getAuthURL());

    connection.ready(function () {
        console.log('ready');
        connection.getFolderItems(0, {limit: 10}, function (err, result) {
            console.log('getFolderItems');
            if (err) {
                console.error(JSON.stringify(err.context_info));
            }
            console.dir(result);
        });
    });

    // return convertRecordToObject(results);
};
