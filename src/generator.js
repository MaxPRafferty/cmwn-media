/**
 * File to help build json from directory
 *
 * This file is not intended to be production worthy
 */
var fs = require('fs');
var path = require('path');
var basePath = path.normalize(__dirname + '/../media');
var crypto = require('crypto');
var md5File = require('md5-file');
var mime = require('mime');
var js2xmlparser = require('js2xmlparser');
var assets = [];

function scanDir(dir) {
    'use strict';
    console.log('=========');
    console.log('scanning: ' + dir);
    var dirStats = fs.readdirSync(dir);

    for (var index in dirStats) {
        var fileName = dirStats[index];

        // damn it mac
        if (fileName === '.DS_Store') {
            continue;
        }

        console.log('Checking: ' + fileName);

        var fullChildFile = dir + '/' + fileName;
        console.log('fullChildFile: ' + fullChildFile);

        var newStats = fs.statSync(fullChildFile);

        // descend into directories
        if (newStats.isDirectory()) {
            console.log('Found directory: ' + fullChildFile);
            scanDir(fullChildFile);
            continue;
        }

        // Remove base path
        var relativeDir = dir.replace(basePath + path.sep, '');

        // 1st part of the path is the type
        var firstPath = relativeDir.indexOf('/') >= 0 ? relativeDir.indexOf('/') : relativeDir.length;
        var type = relativeDir.substr(0, firstPath).toLocaleLowerCase();

        // simple remove plurals
        if (type.substr(-1, 1) === 's') {
            type = type.substr(0, type.length - 1);
        }

        // replace directory seperators with '>'
        console.log('Type: ' + type);
        var category = relativeDir.replace(/\//g, ' > ');
        console.log('Category: ' + category);

        // sha 256 the name of the file and the category
        var assetId = crypto.createHash('sha256', category)
            .update(fileName)
            .digest('hex');

        var checkSum = md5File.sync(fullChildFile);
        console.log('Id: ' + assetId);

        var mimeType = mime.lookup(fullChildFile);
        console.log('Mime Type: ' + mimeType);

        // TODO compare if there is already an file and merge them in
        var assetData = {
            'asset_id': assetId,
            'directory': relativeDir,
            'check': checkSum,
            'mime_type': mimeType,
            'type': type,
            'file_name': fileName,
            'category': category,
            'order': index,
            'can_overlap': true
        };

        console.log(assetData);
        assets.push(assetData);
    }
}

scanDir(basePath);

console.log('Completed Scan: ');
console.log(assets);
var options = {
    arrayMap: {
        assets: 'item'
    }
};

var buffer = new Buffer(js2xmlparser('assets', assets, options));
fs.open(__dirname + '/api.xml', 'w', function (openErr, fd) {
    'use strict';
    if (openErr) {
        throw 'Could not open file: ' + openErr;
    }

    fs.write(fd, buffer, 0, buffer.length, null, function (writeErr) {
        if (writeErr) {
            throw 'Could not write to file: ' + writeErr;
        }

        fs.close(fd, function () {
            console.log('Done writing file.  Closing');
            process.exit(0);
        });
    });
});
