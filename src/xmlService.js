var fs = require('fs');
var xpath = require('xpath');
var DOMParser = require('xmldom').DOMParser;
var xmlString = fs.readFileSync(__dirname + '/api.xml');

console.log('Loading xml');
var doc = new DOMParser().parseFromString(xmlString.toString('utf8'), 'text/xml');
var exports = module.exports = {};

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
    page = parseInt(page, 1) || 1;
    perPage = parseInt(perPage, 1) || 10;
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
    var results = xpath.select('//item/asset_id[text()="' + assetId + '"]', doc);
    console.log('# results: ' + results.length);

    return convertRecordToObject(results[0].parentNode);
};
