import docParser from 'docparser-node';
import fs from 'fs';
import process from 'dotenv'
import path from 'path';
import mongodb from 'mongodb';
import { Configuration, OpenAIApi } from 'openai';
const __dirname = path.dirname('.');
console.log("Working Directory: ", __dirname)
const env = process.config({path: path.resolve('.env')});
console.log(env);

const apiKey = env.parsed.APIKEY
console.log("Using API Key: ", apiKey);
const client = new docParser.Client(apiKey); // api key
const fsFolder = env.parsed.FSEOBFOLDER;
console.log("@Subdirectory: ", fsFolder);
const parserId = env.parsed.EOBPARSERID
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
        summarizeData(json, openai, instructions, function(d){
            const jsonStr = JSON.stringify(d);
            console.log("Saving to document: ", file)
            fs.writeFile(file, jsonStr, function(err){
                if(err) throw err;
                console.log("Successfully overwritten: ", file);
                const document = fs.readFileSync(file, 'utf8');
                const data = JSON.parse(document);
                //console.log("Parsed Data: ", data[0]);
                callback(data[0]);
            }); 
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
        const db = await client.db("EOB");
        console.log("Database: ", db.databaseName);
        const rc = await db.collection("Steelgem");
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

const configuration = new Configuration({
    apiKey: env.parsed.OPENAIAPIKEY,
    echo: true
});

const openai = new OpenAIApi(configuration);
const prompt = "1) Parse the data into this: \n"; 
const parse = "2) Notes | Payee | Provider | Reference ID | DOS | Charges | Patient|Remark | Claim Number | Claim Date | Patient | Responsibility \n";
const questions = "3) Then summarize the parsed data by answering the following: Who is the provider? Who is the payee? Who received the services? Who are the responsible parties? How much do each party owe? What is your confidence level % of your findings? \n";
const summary = "4) Then parse the summary into Services | Claims | Patients | Notes. \n";
const constraints = "5) Constraints: Only return the parsed summary with the confidence level of 100%. Cheapen yourself as much possible in regards to tokens spent. \n"; 
const instructions = "\n" + prompt + parse + questions + summary + constraints; //add the data later

async function summarizeData(d, o, i, cb) {
    const openaiPrompt = d[0].data + i; 
    const response = await o.createCompletion({
        model: "text-davinci-003",
        prompt: openaiPrompt,
        temperature: 0.14,
        max_tokens: 306,
        top_p: 1,
        best_of: 25,
        frequency_penalty: 0.75,
        presence_penalty: 0.31,
    });
    const findings = response.data;
    const choices = findings.choices;
    console.log(choices);
    let data = d;
    data[0]["summary"] = choices; // push summary into object
    cb(data);
}

async function runMain() {
    await fs.readdir(jsonFolder, (err, files) => {
       if (err) throw err;
       files.forEach(file => {
           const filePath = path.resolve(jsonFolder + file);
           let isDirectory = isDir(filePath);
           if(isDirectory === false) {
               console.log("Reading: ", filePath);
               const id = file.split(".")[0]; // grabs the id from file name
               getResultsByDocument(parser.id, id, filePath, function(data) {
                   main(data, connStr, jsonFolder, filePath, file).catch(err => console.log(err));
               });
           }
       });
   });
}

await runMain();
