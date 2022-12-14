import docParser from 'docparser-node';
import fs from 'fs';
import process from 'dotenv'
import path from 'path';
import mongodb from 'mongodb';
const __dirname = path.dirname('./');
console.log("Working Directory: ", __dirname)
const env = process.config({path: path.resolve(__dirname + '\\.env')});
console.log(env);

const apiKey = env.parsed.APIKEY
console.log("Using API Key: ", apiKey);
const client = new docParser.Client(apiKey); // api key
const fsFolder = path.resolve(__dirname + env.parsed.FSVOBFOLDER);
console.log("@Subdirectory: ", fsFolder);
const parserId = env.parsed.VOBPARSERID
const jsonFolder = path.resolve(fsFolder + '\\json\\');
const connStr = env.parsed.CONNECTION_STRING;

//const apiKey = "810fa30e4ff6186e3b886f0c7f37411dbd85a778";
//const client = new docParser.Client("810fa30e4ff6186e3b886f0c7f37411dbd85a778"); // api key
//const fsFolder = 'fs/vobs/' // path of vob files
//const parserId = 'shodskezdfwg'; // for parsing vobs

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
        console.log("Retrieved Parsed Data: ", res);
        const json = res;
        const jsonStr = JSON.stringify(json);
        console.log("Saving to document: ", file)
        fs.writeFile(file, jsonStr, function(err){
            if(err) throw err;
            console.log("Successfully overwritten: ", file);
            const document = fs.readFileSync(file, 'utf8');
            const data = JSON.parse(document);
            console.log("Parsed Data: ", data[0]);
            callback(data[0]);
        }); 
    })
    .catch(function (err) {
        console.log(err);
        return false;
    });
}

async function main(data, cStr) {
    console.log("Connecting to MongoDB: ", cStr);
    const client = new mongodb.MongoClient(cStr);
    try {
        await client.connect();
        const db = await client.db("VOB");
        console.log("Database: ", db.databaseName);
        const rc = await db.collection("Hansei");
        console.log("Collection: ", rc.collectionName);
        await rc.insertMany(data)
        .then(function (result) {
            console.log(result);
        }).catch(err => console.log(err));
        //console.log("Looking for messages ...")
        //var query = {"message": /^Hello/};
        //const mgs = await rc.find(query).toArray();
        //console.log(mgs);
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
        const filePath = path.resolve(jsonFolder + "\\" + file);
        let isDirectory = isDir(filePath);
        if(isDirectory === false) {
            console.log("Reading: ", filePath);
            const id = file.split(".")[0]; // grabs the id from file name
            getResultsByDocument(parser.id, id, filePath, function(data){
                main(data, connStr).catch(err => console.log(err));
            });
        }
    });
});