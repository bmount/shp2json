var spawn = require('child_process').spawn;
var fs = require('fs');
var path = require('path');
var seq = require('seq');
var BufferedStream = require('morestreams').BufferedStream;

module.exports = function (inStream) {
    var id = Math.floor(Math.random() * (1<<30)).toString(16);
    var tmpDir = path.join('/tmp', id);
    var zipFile = path.join('/tmp', id + '.zip');
    
    var outStream = new BufferedStream;
    outStream.readable = true;
    outStream.writable = true;
    
    var zipStream = fs.createWriteStream(zipFile);
    inStream.pipe(zipStream);
    zipStream.on('error', outStream.emit.bind(outStream, 'error'));
    
    seq()
        .par(function () { fs.mkdir(tmpDir, 0700, this) })
        .par(function () {
            if (zipStream.closed) this()
            else zipStream.on('close', this.ok)
        })
        .seq_(function (next) {
            var ps = spawn('unzip', [ '-d', tmpDir, zipFile ]);
            ps.on('exit', function (code) {
                next(code < 3 ? null : 'error in unzip: code ' + code)
            });
        })
        .seq(function () { fs.readdir(tmpDir, this) })
        .seq(function (files) {
            var shpFiles = files.filter(function (file) {
                return file.match(/\.shp$/i)
            });
            if (shpFiles.length === 0) {
                this('no .shp files found in the archive');
            }
            else if (shpFiles.length > 1) {
                this('multiple .shp files found in the archive,'
                    + ' expecting a single file')
            }
            else {
                var ps = spawn('ogr2ogr', [
                    '-f', 'GeoJSON',
                    '-skipfailures',
                    'stdout',
                    path.join(tmpDir, shpFiles[0]),
                ]);
                ps.stdout.pipe(outStream, { end : false });
                ps.stderr.pipe(outStream, { end : false });
                
                var pending = 2;
                function onend () { if (--pending === 0) outStream.end() }
                ps.stdout.on('end', onend);
                ps.stderr.on('end', onend);
            }
        })
        .catch(function (err) {
            outStream.emit('error', err);
        })
    ;
    
    return outStream;
};
