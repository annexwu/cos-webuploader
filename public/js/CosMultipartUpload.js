(function () {
	// 获取 bucket 信息：https://console.qcloud.com/cos4/bucket
	var appid = '';
	var bucket = '';
	var region = ''; // 华南:cn-south 华北:cn-north 华东:cn-east

	var cosSid = '';
	var cosSkey = '';

	// taskItem 通过 file.id 映射，每个 taskItem 参数为： uploadId
	var taskList = {};

	var getCosUrl = function (path) {
		path.charAt(0) == '/' && (path = path.substr(1));
		path = encodeURIComponent(path);
		return location.protocol + '//' + bucket + '-' + appid + '.' + region + '.myqcloud.com/' + path;
	};

	// 获取签名的方法
	var getAuthorization = function(options) {
		/*
		var authorization = COS.getAuthorization({
			SecretId: cosSid,
			SecretKey: cosSkey,
			method: (options.method || 'get').toLowerCase(),
			pathname: options.pathname || '/',
		});

		return authorization;
		*/
		
		var sign = '';

		// 向后端服务器请求签名，传入参数为 method 和 pathname
		$.ajax({
			url: '/sign',
			method : 'POST',
			data: {method: (options.method || 'get').toLowerCase(), pathname: options.pathname || '/'},
			async: false,
			dataType : 'json',
			success: function(ret) {
				sign = ret.auth;
			}
		});

		return sign;
	};

	// 获取 complete upload 时候回传的 ETag 信息正文
	var getEtagsBody = function (ETags) {
		var i, xml = '<CompleteMultipartUpload>';
		for (i in ETags) {
			xml += '<Part><PartNumber>' + ETags[i].PartNumber + '</PartNumber><ETag>' + ETags[i].ETag + '</ETag></Part>';
		}
		xml += '</CompleteMultipartUpload>';
		return xml;
	};

	// 用于清空和覆盖 targetData
	var setData = function(targetData, sourceData, clear) {
		if(clear) {
			$.each(targetData, function(k, v) {
				delete targetData[k];
			});
		}

		$.each(sourceData, function(k, v) {
			targetData[k] = v;
		});
	};

	// 添加上传任务，一个文件 id 对应一个上传任务
	var addTask = function(file) {
		!taskList[file.id] && (taskList[file.id] = {
			uploadId : '',
			fileName : file.name,
			ETags : [],
			ETagsMap : {}
		});
	};

	// 获取上传任务
	var getTask = function(fileId) {
		return taskList[fileId] || {};
	};

	// 在对应的上传任务中，添加回传 ETag 信息
	var addETag = function(fileId, ETag) {
		var task = taskList[fileId];
		task.ETags.push(ETag);
		task.ETagsMap[ETag.PartNumber] = ETag;
	};

	var xml2json = function (data) {
		var x2jsObj = new X2JS();

		if (typeof data == 'string') {
			return x2jsObj.xml_str2json(data);
		} 

		return x2jsObj.xml2json(data);
	};

	var json2xml = function(data){
		var x2jsObj = new X2JS();
		return x2jsObj.json2xml_str(data);
	};

	// 初始化分块上传，获取 uploadId
	var initMultipartUpload = function(fileId, callbacks) {
		var task = taskList[fileId];
		callbacks = callbacks || {};
		var successCallback = callbacks.success,
			failCallback = callbacks.fail,
			fileName = task.fileName;

		// uploadId 已经存在，无需重新获取
		if(task.uploadId && task.uploadId.length) {
			successCallback({
				uploadId : task.uploadId,
				fileName : fileName,
			});
			return;
		}

		$.ajax({
			type: 'POST',
			url: getCosUrl(fileName) + '?uploads',
			async : false,
			beforeSend: function (xhr) {
				xhr.setRequestHeader('Authorization', getAuthorization({
					method : 'POST',
					pathname : '/' + fileName
				}));
			},
			success: function (r) {
				var uploadId = $(r).find('UploadId')[0].textContent;

				task.uploadId = uploadId;
				
				successCallback({
					uploadId : uploadId,
					fileName : fileName,
				});
			}, 
			error : function(err) {
				failCallback({
					error : err || ''
				});
			}
		});
	};
	
	// 获取分块的上传的地址，以及设置 data 和 headers
	var getSliceUploadURL = function(fileId, partNumber, data, headers) {
		var task = taskList[fileId],
			uploadId = task.uploadId,
			fileName = task.fileName;

		if(uploadId && uploadId.length) {
			setDataHeaders(fileId, partNumber, data, headers);

			return getCosUrl(fileName);
		}

		return 'NO_UPLOAD_ID_ERROR';
	};

	// 所有分块上传成功，开始合并文件分块
	var completeMultipartUpload = function(fileId,  callbacks) {
		var task = taskList[fileId],
			uploadId = task.uploadId,
			fileName = task.fileName,
			ETags = task.ETags;

		callbacks = callbacks || {};

		var successCallback = callbacks.success,
			failCallback = callbacks.fail;

		ETags.sort(function(item1, item2) {
			return item1.PartNumber - item2.PartNumber;
		});

		var XMLContent = getEtagsBody(ETags);

		$.ajax({
			type: 'POST',
			url: getCosUrl(fileName) + '?uploadId=' + uploadId,
			async : false,
			data : XMLContent,
			beforeSend: function (xhr) {
				xhr.setRequestHeader('Authorization', getAuthorization({
					method : 'POST',
					pathname : '/' + fileName
				}));
				xhr.setRequestHeader('Content-Type', 'application/xml');
			},
			success: function (r) {
				var ETag = $(r).find('ETag')[0].textContent,
					Location = $(r).find('Location')[0].textContent;

				successCallback({
					ETag : ETag,
					Location : Location
				});
			},
			error : function(err) {
				failCallback({
					error : err || ''
				});
			}
		});
	};

	var setDataHeaders = function(fileId, partNumber, data, headers) {
		var task = taskList[fileId],
			uploadId = task.uploadId,
			fileName = task.fileName;

		data && (setData(data, {}, true));

		var Authorization = getAuthorization({
			method : 'PUT',
			pathname : '/' + fileName
		});

		data['uploadId'] = uploadId;
		data['partNumber'] = partNumber;
		headers && (headers['Authorization'] = Authorization);
	};

	var multipartListPart = function(param, callback) {
		param = param || {};
		var uploadId = param.uploadId || '',
			partNumberMarker = param.partNumberMarker || 0,
			fileName = param.fileName || '';

		if(uploadId && uploadId.length) {
			$.ajax({
				type: 'GET',
				url: getCosUrl(fileName) + '?uploadId=' + uploadId + (partNumberMarker ? '&part-number-marker=' + partNumberMarker : ''),
				async : false,
				beforeSend: function (xhr) {
					xhr.setRequestHeader('Authorization', getAuthorization({
						method : 'GET',
						pathname : '/' + fileName
					}));
				},
				success: function (r) {
					var data = {};

					try {
						data = xml2json(r); 
					} catch(e) {
						callback(e);
						return;
					}

					var ListPartsResult = data.ListPartsResult || {};
					var Part = ListPartsResult.Part || [];

					if(!(Part instanceof Array)) {
						Part = [Part];
					}

					ListPartsResult.Part = Part;
					callback(null, ListPartsResult);
				}, 
				error : function(err) {
					callback(err || '');
				}
			});
		} else {
			callback('NO_UPLOAD_ID_ERROR');
		}
	};

	var getListParts = function(fileId, callbacks) {
		var task = taskList[fileId],
			uploadId = task.uploadId,
			fileName = task.fileName;

		callbacks = callbacks || {};

		var successCallback = callbacks.success,
			failCallback = callbacks.fail;

		var partList = [];

		var sendParams = {
			uploadId : uploadId,
			fileName : fileName
		};

		var next = function () {
			multipartListPart(sendParams, function (err, data) {
				if (err) {
					failCallback({
						error : err
					});

					return;
				}
				Array.prototype.push.apply(partList, data.Part || []);
				if (data.IsTruncated == 'true') { // 列表不完整
					sendParams.partNumberMarker = data.NextPartNumberMarker;
					next();
				} else {
					task.ETags = partList;
					task.ETagsMap = {};
					$.each(partList, function(k, v) {
						task.ETagsMap[v.PartNumber + ''] = v;
					});

				}
			});
		};
		next(); 
	};

	var checkSliceUploaded = function(fileId, partNumber, ETag) {

		var task = taskList[fileId],
			fileName = task.fileName,
			ETagsMap = task.ETagsMap;

		if(ETagsMap[partNumber + '']) {
			return true;
		}

		return false;

	};
/*
	var getFileUploadId = function(fileId) {

		var task = taskList[fileId],
			fileName = task.fileName;

		$.ajax({
			type: 'GET',
			url: getCosUrl('') + '?uploads&prefix=' + encodeURIComponent(fileName),
			async : false,
			beforeSend: function (xhr) {
				xhr.setRequestHeader('Authorization', getAuthorization({
					method : 'GET',
					pathname : '/' + fileName
				}));
			},
			success: function (r) {
				console.log(r);
			}, 
			error : function(err) {
				
			}
		});
	};
*/

/*
	var getTotalUploadURL = function(fileId) {
		var task = taskList[fileId],
			fileName = task.fileName;

		var Authorization = getAuthorization({
			method : 'PUT',
			pathname : '/' + fileName
		});
		

		return getCosUrl(fileName) + '?' + 'sign=' + encodeURIComponent(Authorization);
	};
*/

/*
	var putObject = function(fileId, file, callbacks) {
		var task = taskList[fileId],
			fileName = task.fileName;

		callbacks = callbacks || {};

		var successCallback = callbacks.success,
			failCallback = callbacks.fail;

		$.ajax({
			type: 'PUT',
			url: getCosUrl(fileName),
			async : false,
			processData : false,
			data : file,
			beforeSend: function (xhr) {
				xhr.setRequestHeader('Authorization', getAuthorization({
					method : 'PUT',
					pathname : '/' + fileName
				}));
			},
			success: function (r) {

				successCallback(r);
			},
			error : function(err) {
				failCallback({
					error : err
				});
			}
		});
	};
*/
	// 对外暴露的接口
	var CosMultipartUpload = function(param) {
		appid = param.appid;
		bucket = param.bucket;
		region = param.region; // 华南:cn-south 华北:cn-north 华东:cn-east

		cosSid = 'AKIDjNwKfpI2qVeondCiAcwBGCNZfaLwjgw2';
		cosSkey = '3g7PUNc1oEfwCGLH2b2IME2srNo7II7n';

		var COS_API = {
			getAuthorization : getAuthorization,
			addTask : addTask,
			getTask : getTask,
			addETag : addETag,
			checkSliceUploaded : checkSliceUploaded,
			initMultipartUpload : initMultipartUpload,
			getSliceUploadURL : getSliceUploadURL,
			completeMultipartUpload : completeMultipartUpload,
			getListParts : getListParts,
			//getFileUploadId : getFileUploadId
			//setData : setData,
			//getEtagsBody : getEtagsBody,
			//putObject : putObject,
			//getTotalUploadURL : getTotalUploadURL,
			//getFileUrl : getFileUrl,
			//setDataHeaders : setDataHeaders
		};

		return COS_API;
	};

	window.CosMultipartUpload = CosMultipartUpload;
})();