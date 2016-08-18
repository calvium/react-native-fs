'use strict';

// This file supports both iOS and Android

// Stop bluebird going nuts because it can't find "self"
if (typeof self === 'undefined') {
  global.self = global;
}

var RNFSManager = require('react-native').NativeModules.RNFSManager;
var NativeAppEventEmitter = require('react-native').NativeAppEventEmitter;  // iOS
var DeviceEventEmitter = require('react-native').DeviceEventEmitter;        // Android
var Promise = require('bluebird');
var base64 = require('base-64');
var utf8 = require('utf8');

var _readDir = Promise.promisify(RNFSManager.readDir);
var _readDirAssets = RNFSManager.readDirAssets ? Promise.promisify(RNFSManager.readDirAssets) : undefined;
var _exists = Promise.promisify(RNFSManager.exists);
var _stat = Promise.promisify(RNFSManager.stat);
var _readFile = Promise.promisify(RNFSManager.readFile);
var _readFileAssets = RNFSManager.readFileAssets ? Promise.promisify(RNFSManager.readFileAssets) : undefined;
var _copyFileAssets = RNFSManager.copyFileAssets ? Promise.promisify(RNFSManager.copyFileAssets) : undefined;
var _existsAssets = RNFSManager.existsAssets ? Promise.promisify(RNFSManager.existsAssets) : undefined;
var _writeFile = Promise.promisify(RNFSManager.writeFile);
var _moveFile = Promise.promisify(RNFSManager.moveFile);
var _copyFile = Promise.promisify(RNFSManager.copyFile);
var _unlink = Promise.promisify(RNFSManager.unlink);
var _mkdir = Promise.promisify(RNFSManager.mkdir);
var _downloadFile = Promise.promisify(RNFSManager.downloadFile);
var _pathForBundle = Promise.promisify(RNFSManager.pathForBundle);

var convertError = (err) => {
  if (err.isOperational && err.cause) {
    err = err.cause;
  }

  var error = new Error(err.description || err.message);
  error.code = err.code;
  throw error;
};

var NSFileTypeRegular = RNFSManager.NSFileTypeRegular;
var NSFileTypeDirectory = RNFSManager.NSFileTypeDirectory;

var jobId = 0;

var getJobId = () => {
  jobId += 1;
  return jobId;
};

// Generic read file function used for readFile and readFileAssets
var readFileActual = (filepath, encoding, readFileFunction)=> {
  if (!encoding) encoding = 'utf8';

  if (!readFileFunction) {
    throw new Error("Not available on this platform");
  }

  return readFileFunction(filepath)
      .then((b64) => {
        var contents;

        if (encoding === 'utf8') {
          contents = utf8.decode(base64.decode(b64));
        } else if (encoding === 'ascii') {
          contents = base64.decode(b64);
        } else if (encoding === 'base64') {
          contents = b64;
        } else {
          throw new Error('Invalid encoding type "' + encoding + '"');
        }

        return contents;
      })
      .catch(convertError);
};

// Generic read dir function used for readDir and readDirAssets
var readDirActual = (dirpath, readDirFunction)=> {
  if (!readDirFunction) {
    throw new Error("Not available on this platform");
  }

  return readDirFunction(dirpath)
      .then(files => {
        return files.map(file => ({
          name: file.name,
          path: file.path,
          size: file.size,
          isFile: () => file.type === NSFileTypeRegular,
          isDirectory: () => file.type === NSFileTypeDirectory,
        }));
      })
      .catch(convertError)
}

var RNFS = {

  readDir(dirpath) {
    return readDirActual(dirpath, _readDir);
  },

  // Android-only
  readDirAssets(dirpath) {
    return readDirActual(dirpath, _readDirAssets);
  },

  // Android-only
  existsAssets(filepath) {
    return _existsAssets(filepath)
      .catch(convertError);
  },

  // Node style version (lowercase d). Returns just the names
  readdir(dirpath) {
    return RNFS.readDir(dirpath)
      .then(files => {
        return files.map(file => file.name);
      });
  },

  stat(filepath) {
    return _stat(filepath)
      .then((result) => {
        return {
          'ctime': new Date(result.ctime*1000),
          'mtime': new Date(result.mtime*1000),
          'size': result.size,
          'mode': result.mode,
          isFile: () => result.type === NSFileTypeRegular,
          isDirectory: () => result.type === NSFileTypeDirectory,
        };
      })
      .catch(convertError);
  },

  exists(filepath) {
    return _exists(filepath)
      .catch(convertError);
  },

  readFile(filepath, encoding) {
    return readFileActual(filepath, encoding, _readFile);
  },

  // Android only
  readFileAssets(filepath, encoding) {
    return readFileActual(filepath, encoding, _readFileAssets);
  },

  // Android only
  copyFileAssets(filepath, destination) {
    if (!_copyFileAssets) {
      throw new Error("Not available on this platform");
    }
    return _copyFileAssets(filepath, destination)
        .catch(convertError);
  },

  writeFile(filepath, contents, encoding, options) {
    var b64;

    if (!encoding) encoding = 'utf8';

    if (encoding === 'utf8') {
      b64 = base64.encode(utf8.encode(contents));
    } else if (encoding === 'ascii') {
      b64 = base64.encode(contents);
    } else if (encoding === 'base64') {
      b64 = contents;
    } else {
      throw new Error('Invalid encoding type "' + encoding + '"');
    }

    return _writeFile(filepath, b64, options)
      .catch(convertError);
  },

  moveFile(filepath, destPath) {
    return _moveFile(filepath, destPath)
      .catch(convertError);
  },

  copyFile(filepath, destPath) {
    return _copyFile(filepath, destPath)
        .catch(convertError);
  },

  pathForBundle(bundleName) {
    return _pathForBundle(bundleName);
  },

  unlink(filepath) {
    return _unlink(filepath)
      .catch(convertError);
  },

  mkdir(filepath, excludeFromBackup) {
    excludeFromBackup = !!excludeFromBackup;
    return _mkdir(filepath, excludeFromBackup)
      .catch(convertError);
  },

  downloadFile(fromUrl, toFile, begin, progress) {
    var jobId = getJobId();
    var subscriptionIos, subscriptionAndroid;

    if (!begin) begin = (info) => {
      console.log('Download begun:', info);
    };

    if (begin) {
      // Two different styles of subscribing to events for different platforms, hmmm....
      if (NativeAppEventEmitter.addListener)
        subscriptionIos = NativeAppEventEmitter.addListener('DownloadBegin-' + jobId, begin);
      if (DeviceEventEmitter.addListener)
        subscriptionAndroid = DeviceEventEmitter.addListener('DownloadBegin-' + jobId, begin);
    }

    if (progress) {
      if (NativeAppEventEmitter.addListener)
        subscriptionIos = NativeAppEventEmitter.addListener('DownloadProgress-' + jobId, progress);
      if (DeviceEventEmitter.addListener)
        subscriptionAndroid = DeviceEventEmitter.addListener('DownloadProgress-' + jobId, progress);
    }

    return _downloadFile(fromUrl, toFile, jobId)
      .then(res => {
        if (subscriptionIos) subscriptionIos.remove();
        if (subscriptionAndroid) subscriptionAndroid.remove();
        return res;
      })
      .catch(convertError);
  },

  stopDownload(jobId) {
    RNFSManager.stopDownload(jobId);
  },

  MainBundlePath: RNFSManager.MainBundlePath,
  CachesDirectoryPath: RNFSManager.NSCachesDirectoryPath,
  DocumentDirectoryPath: RNFSManager.NSDocumentDirectoryPath,
  ExternalDirectoryPath: RNFSManager.NSExternalDirectoryPath,
  LibraryDirectoryPath: RNFSManager.NSLibraryDirectoryPath,
  PicturesDirectoryPath: RNFSManager.NSPicturesDirectoryPath
};

module.exports = RNFS;
