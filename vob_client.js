import docParser from 'docparser-node';
import fs from 'fs';
import process from 'dotenv'
import path from 'path';
import mongodb from 'mongodb';
const __dirname = path.dirname('.');
console.log("Working Directory: ", __dirname)
const env = process.config({path: path.resolve('.env')});
console.log(env);

const apiKey = env.parsed.APIKEY
console.log("Using API Key: ", apiKey);
const client = new docParser.Client(apiKey); // api key
const fsFolder = env.parsed.FSVOBFOLDER;
console.log("@Subdirectory: ", fsFolder);
const parserId = env.parsed.VOBPARSERID
const jsonFolder = fsFolder + 'json/';
const connStr = env.parsed.CONNECTION_STRING;

client.ping().then(function(){
    console.log('Connection established');
}).catch(function(err){
    console.log('Error: ', err);
});

const parsers = await client.getParsers()
    .then(function (parsers) {
        console.log("Found Parsers: ", parsers);
        return parsers;
    }).catch(function (err) {console.log(err)});


async function findParserbyId (ps, pid) {
    for(var i = 0; i < ps.length; i++) {
        if( ps[i].id === pid ) {
            console.log("Found parser: ", ps[i]);
            return ps[i];
        }
    }
}

const parser = await findParserbyId(parsers, parserId);

function getData(parserId) {
    // option parameters:
    // list: "last_uploaded, uploaded_after, processed_after some date"
    // limit: number, max 10,000
    //
    client.getResultsByParser(parserId, {format: 'object'})
    .then(function (result) {
        console.log(result)
    })
    .catch(function (err) {
        console.log(err)
    });
}

function isDir(path) {
    try {
        var stat = fs.lstatSync(path);
        return stat.isDirectory();
    } catch (e) {
        // lstatSync throws an error if path doesn't exist
        return false;
    }
}

// client.uploadFileByPath('PARSER_ID', './test.pdf', {remote_id: guid})
// const pattern = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'i');

async function getResultsByDocument(parserId, docId, file, callback) {
    await client.getResultsByDocument(parserId, docId, {format: 'object'})
    .then(function (res) {
        //console.log("Retrieved DocParser Data: ", res);
        const json = res;
        const jsonStr = JSON.stringify(json);
        console.log("Saving to document: ", file)
        fs.writeFile(file, jsonStr, function(err){
            if(err) throw err;
            console.log("Successfully overwritten: ", file);
            const document = fs.readFileSync(file, 'utf8');
	    const data = JSON.parse(document);
	    //console.log("Parsed Data: ", data[0]);
            callback(data[0]);
        }); 
    })
    .catch(function (err) {
        console.log(err);
        return false;
    });
}

async function main(data, cStr, j, fp, f) {
    console.log("Connecting to MongoDB: ", cStr);
    const client = new mongodb.MongoClient(cStr);
    try {
        await client.connect();
        const db = await client.db("VOB");
        console.log("Database: ", db.databaseName);
        const rc = await db.collection("Hansei");
        console.log("Collection: ", rc.collectionName);
	const query = { document_id: data["document_id"] };
	const update = { $set: data };
	const options = { upsert:true };
	await rc.updateOne(query, update, options).then(function (result){
	   console.log(result);
           const json_processed = path.resolve(j + 'processed_json/' + f);
           fs.rename(fp, json_processed, function(err) {
           if(err) throw err;
    	   console.log("Successfully moved " + fp + " to" + json_processed);
          });
	}).catch(err => console.log(err));
	/*await rc.insertOne(data)
        .then(function (result) {
            console.log(result);
        }).catch(err => console.log(err));*/
    }
    catch(err) {
        console.log(err);
    }
    finally {
        await client.close();
    }
}

await fs.readdir(jsonFolder, (err, files) => {
    files.forEach(file => {
        const filePath = path.resolve(jsonFolder + file);
        let isDirectory = isDir(filePath);
        if(isDirectory === false) {
            console.log("Reading: ", filePath);
            //const id = file.split(".")[0]; // grabs the id from file name
            const doc = fs.readFileSync(filePath, 'utf8');
            const jData = JSON.parse(doc);
            //const id = jData["id"];
            var id = '';
            if(jData[0]) {
               id = jData[0]["document_id"] ? jData[0]["document_id"] : jData["id"];
            }
            else{
               id = jData["id"];
            }
            getResultsByDocument(parser.id, id, filePath, function(data){
		const file_name = data.file_name.replace(".pdf", "." + id + ".json");
	    	main(data, connStr, jsonFolder, filePath, file_name).catch(err => console.log(err));
	    });
        }
    });
});

