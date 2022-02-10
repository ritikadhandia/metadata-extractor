var express = require('express')
//var http = require('http')
//var https = require('https')	
var path = require('path')
var formidable = require('formidable');
var sfdx = require('sfdx-node');
var fs = require('fs');
var cookie = require('cookie');
var PORT = process.env.PORT || 8081

var app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/views'));
app.use(express.static(path.join(__dirname, '/public')));
//app.use(session({secret:"S3CRE7", resave:true, saveUninitialized:true}));


app.get('/services/oauth2/authorize', function(req, res){

	console.log('Here');
	console.log(req.query);
	console.log(req.query.redirect_uri);
	var instanceurl = 'https://login.salesforce.com';
	var params = '';

	sfdx.auth.webLogin({
	  		setalias: 'DevOrg',
	  		instanceurl: instanceurl,
	  		_quiet:false
		})
		.then((result) => {
			console.log(result);
			params +='access_token='+result.accessToken+
					'&instance_url='+result.instanceUrl+
					'&refresh_token='+result.refreshToken+
					'&token_type=Bearer'+
					'&scope=full+refresh_token';
			if(req.query.state){
				params += '&state='+req.query.state;
			}
			res.redirect('https://login.salesforce.com/services/oauth2/success#'+params);
		});

})

app.get('/', function(req, res){
	console.log('1');

	res.render('pages/index', {
    	displaySection:'login',
    	types: {},
    	folderSection: false
  	});
});

app.post('/generatePackage', function(req, res){

  	
	var cookies = cookie.parse(req.headers.cookie);
	console.log('*******');
	console.log(cookies);
	var targetDirName = 'dir_'+cookies.username+'_'+cookies.orgId;
	
	let formData = '';
	req.on('data', chunk => {
		formData += chunk;
	})
	req.on('end', () => {
		generatePackageXML(formData, targetDirName);
		res.setHeader('Content-type', 'text/plain');
		res.status(200);
		res.write('Done James');
		res.end();
	});

	/*
	sfdx.mdapi.retrieve({
        targetusername: 'DevOrg',
        RETRIEVETARGETDIR: 'downloads/'+targetDirName,
        UNPACKAGED: 'downloads/'+targetDirName+'/CustomPackage.xml' ,
        _quiet:false
    })
    .then((result) => {
		console.log('Downloaded');
		res.setHeader('Content-type', 'text/plain');
		res.status(200);
		res.write('Done James');
		res.end();
	})
	*/
	
	//initiatePackageDownload()
});

app.get('/downloadFile', (req, res) => {

	var cookies = cookie.parse(req.headers.cookie);
	var targetDirName = 'dir_'+cookies.username+'_'+cookies.orgId;
	let filePath = 'downloads/'+targetDirName+'/CustomPackage.xml'
	res.download(filePath, 'Package.xml', function(err){
  		//CHECK FOR ERROR
		fs.unlink(filePath, function(err){
  			console.log('File Removed');
  		});
	});

})
	
app.get('/fetchFolderNames', function(req, res){
	
	var metadataType = req.query.metadataType;
	console.log(metadataType);
	var folderType = ''
	switch(metadataType) {
  		case "EmailTemplate":
    		folderType = 'EmailFolder'
    	break;
  		case "Report":
	    	folderType = 'ReportFolder'
	    break;
  		default:
    		folderType = 'DashboardFolder'
	}
	
	console.log(folderType);
	sfdx.mdapi.listmetadata({
		metadatatype: folderType,
		targetusername: 'DevOrg',	
		_quiet: false
	})
	.then((result) => {
		
		var folderData = [];
		if(result instanceof Array){
			folderData = result;
		}
		else{
			folderData.push(result);
		}
		res.status(200).json(folderData);
	})
})

app.get('/fetchModifiedMetadata', function(req, res){

	var timeRange = req.query.timeRange * (-1);
	console.log(timeRange);
	var metadataTypeArray = [];
	var metadataList = [];
	console.log('fetchModifiedMetadata');

	let lstPromises = new Array();
    lstPromises.push(new Promise(resolve=>fetchFolderedMetadata(metadataList,resolve, timeRange, 'EmailTemplate')));
    lstPromises.push(new Promise(resolve=>fetchFolderedMetadata(metadataList,resolve, timeRange, 'Dashboard')));
    lstPromises.push(new Promise(resolve=>fetchFolderedMetadata(metadataList,resolve, timeRange, 'Report')));
    lstPromises.push(new Promise(resolve=>fetchAllOtherMetadataTypes(metadataTypeArray, resolve)));

	Promise.all(lstPromises)
		.then(
			function(){
				let metadataPromise = new Array();
				metadataTypeArray.forEach(function(val){
					metadataPromise.push(new Promise(resolve=>fetchAllModifiedMetadata(metadataList,val,resolve, timeRange)));
				})
				Promise.all(metadataPromise)
				.then(
					function() {
						console.log('*********************************');
						console.log(metadataList);
						res.status(200).json(metadataList);
					}
				)
			}
		)

})

app.get('/fetchMetadata', function(req, res){
	
	//console.log(req.headers.cookie);
	var metadata = req.query.metadataType;
	var folderName = req.query.folderName;
	
	if(folderName){
		folderName = folderName.replace('$', '\$');
		sfdx.mdapi.listmetadata({
			metadatatype: metadata,
			targetusername: 'DevOrg',	
			folder: folderName,
			_quiet: false
		})
		.then((result) => {	
			var metadatas = [];
			if(result instanceof Array){
				metadatas = result;
			}
			else{
				metadatas.push(result);
			}
			res.status(200).json(metadatas);
		})
		.catch((error) => {
			console.log(error);
		})
	}
	else{

		sfdx.mdapi.listmetadata({
			metadatatype: metadata,
			targetusername: 'DevOrg',
			_quiet: false
		})
		.then((result) => {
			var metadatas = [];
			if(result instanceof Array){
				metadatas = result;
			}
			else{
				metadatas.push(result);
			}
			res.status(200).json(metadatas);
		})
		.catch((error) => {
			console.log(error);
		})
	}
})

app.post('/sectionSubmit', function(req, res){
	
	var metadataTypes = [];
	var form = new formidable.IncomingForm();
	form.parse(req, function (err, fields) {
		console.log('----'+ JSON.stringify(fields))
		//var isSandbox = fields.isSandbox;
		var isSandbox = fields.instanceType == "Sandbox";
		var instanceurl = 'https://login.salesforce.com';
		if(isSandbox){
			instanceurl = 'https://test.salesforce.com';
		}
		sfdx.auth.webLogin({
	  		setalias: 'DevOrg',
	  		instanceurl: instanceurl
		})
		.then((result) => {

			console.log(result);
			res.setHeader('Set-Cookie', [
						cookie.serialize('username', result.username, {
						    httpOnly: true,
						    maxAge: 60 * 60 * 24 * 7 // 1 week
						 }),
						cookie.serialize('orgId', result.orgId, {
						    httpOnly: true,
						    maxAge: 60 * 60 * 24 * 7 // 1 week
						})
			]);
			/*
			res.setHeader('Set-Cookie', cookie.serialize('orgId', result.orgId, {
						    httpOnly: true,
						    maxAge: 60 * 60 * 24 * 7 // 1 week
						}));
			*/
	  		
	  		sfdx.mdapi.describemetadata({
	  			targetusername: 'DevOrg'
	  		})
			.then((listResult) => {
				metadataTypes = [];
				listResult.metadataObjects.forEach(function(val){
					metadataTypes.push(val.xmlName);
				});

				metadataTypes.sort();

				res.render('pages/index', {
			    	displaySection:'chooseMetadata',
			    	types: metadataTypes,
			    	folderSection: false
			  	});
			})
		})
		.error((err) => {
			console.log(err);
		})
	});
	
});


app.listen(PORT);

function generatePackageXML(formData, directoryName){
	var xmlData = '<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata">';
	var y = JSON.parse(formData);
	console.log(y);
	for (var key in y) {
		xmlData += '<types>'
		xmlData += '<name>'
		xmlData += key
		xmlData += '</name>'
		y[key].forEach(function(val){
			xmlData +=  '<members>' + val + '</members>'
		})
		xmlData += '</types>'
	}

	xmlData += '<version>45.0</version></Package>'
	
	writeFileSyncRecursive("/downloads/"+directoryName+"/CustomPackage.xml", xmlData);
	//fs.writeFileSync('CustomPackage.xml',xmlData);
}

Date.prototype.addDays = function(days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
}

function fetchAllOtherMetadataTypes(metadataTypeList,resolve){
	console.log('Fetching AllOtherMetadata');
	sfdx.mdapi.describemetadata({
		targetusername: 'DevOrg'
	})
	.then((listResult) => {
	
		listResult.metadataObjects.forEach(function(val){
			var metadataTypeName = val.xmlName;
			if(metadataTypeName != 'EmailTemplate' &&
				metadataTypeName != 'Dashboard' &&
				metadataTypeName != 'Report' &&
				metadataTypeName != 'Document'){
			
					metadataTypeList.push(val.xmlName);
			}

		});
		console.log(metadataTypeList);
		resolve();
	})
}

function fetchFolderedMetadata(metadataList,resolve, timeRange, type){
	
	var rangeDate = new Date().addDays(timeRange);
	var rangeDateStr = rangeDate.toISOString();
	console.log('Fetching ' + type);
	sfdx.data.soqlQuery({
        targetusername: 'DevOrg',
        resultformat:'json',
        query:'SELECT DeveloperName,FolderName,LastModifiedDate FROM '+type+' WHERE LastModifiedDate > '+rangeDateStr
    })
    .then((result1) => {
        result1.records.forEach(function(val){
        	if(val.FolderName.indexOf('Personal Email Templates') == -1){
        		
        		var met = {};
        		met.fullName = val.FolderName.replace(/\s/g, '_')+'/'+val.DeveloperName;
        		met.type = type;
        		metadataList.push(met);
        	}
        })
        console.log(metadataList);
        resolve();
    });
}

function fetchAllModifiedMetadata(metadataList, metadataType, resolve, timeRange){
	console.log('Fetching ' + metadataType);
	sfdx.mdapi.listmetadata({
								metadatatype: metadataType,
								targetusername: 'DevOrg'	
	})
	.then((result) => {
		
		if (typeof(result) != 'undefined' && result != null){
			var metadataListLocal = [];
			if(result instanceof Array){
				metadataListLocal.push(...result);
			}
			else{
				metadataListLocal.push(result);
			}
			metadataListLocal.forEach(function(val){
				var metadataDate = new Date(val.lastModifiedDate);
				var rangeDate = new Date().addDays(timeRange);
				if(metadataDate.getTime() > rangeDate.getTime()){
					metadataList.push(val);
				}
			})
		}
		resolve();
	})
}

function writeFileSyncRecursive(filename, content) {
	
	// create folder path if not exists
	console.log(filename.split('/').slice(0,-1));
	filename.split('/').slice(0,-1).reduce( (last, folder)=>{
		console.log(folder);
		let folderPath = last ? (last + '/' + folder) : folder;
		console.log(folder);
		if (!fs.existsSync(folderPath)){ 
			fs.mkdirSync(folderPath);
		}
		return folderPath
	})
	
	fs.writeFileSync(__dirname+'/'+filename, content)
}


