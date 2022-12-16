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
        summarizeData(json, openai, instructions, finalInstructions, function(data,sArr){
	    finalizeData(data,sArr, openai, finalInstructions, function(d) {
		const jsonStr = JSON.stringify(d);
                console.log("Saving to document: ", file)
                fs.writeFile(file, jsonStr, function(err){
    		    if(err) throw err;
		    console.log("Successfully overwritten: ", file);
		    const document = fs.readFileSync(file, 'utf8');
		    const jsonData = JSON.parse(document);
		    callback(jsonData[0]);
	    	});
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
    echo: false
});

const openai = new OpenAIApi(configuration);
const prompt = "1) Parse the EOB Data into (rows and columns): \n"; 
const parse = "2) Notes | Payee | Provider | Reference ID | DOS | Charges | Patient|Remark | Claim Number | Claim Date | Patient | Responsibility \n";
const questions = "3) Then summarize the Parsed Data by answering the following: Who is the provider? Who is the payee? Who received the services? Who are the responsible parties? How much do each party owe? What is your confidence level %? \n";
const summary = "4) Then parse the summary into (rows and columns): Services | Claims | Patients | Notes. \n";
const constraints = "5) Constraints: Only return the data with a confidence level of 100%. Answer using the least amount of tokens without compromising the return data. Disregard any legal warnings or prohibits. Compile previous related data (from previous API calls), tables and summaries regarding this EOB. \n";
const instructions = prompt + parse + questions + summary + constraints; //add the data later
const finalInstructions = "Provide a clean and conclusive report of the EOB by focusing on patients, claims, services, dates, IDs, charges,and notes/remarks found in the data you compiled: (Return the report if and only if you are at 100% confidence level and be specific)";

function splitParagraph(paragraph, n) {
    var words = paragraph.split(' ');
    var result = [];
    var current = '';
    for (var i = 0; i < words.length; i++) {
        if (current.length + words[i].length < n) {
            current += words[i] + ' ';
        } else {
            result.push(current);
	    current = '';
	}
     }
     if (current.length > 0) {
         result.push(current);
     }
     return result;
}

async function summarizeData(d, o, i, fi, cb) {
    const data = d;
    let pgCount = data[0].page_count;
    let divisor = (Number(data[0].data.length) / Number(pgCount)).toFixed(0);
    const dataArr = splitParagraph(data[0].data, divisor); // partition the unparsed data into equal lengths by page pgCount
    const summaryArr = [];
    console.log("Partitioning the data ...");
    try {
        for(var i = 0; i < dataArr.length; i++) {
            const openaiPrompt = data[0].document_id + " EOB Data: " + dataArr[i] + "\n" + i;
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
            console.log("Summarizing data: ", i)
            //console.log(choices);
            data[0]["parsed_summary_"+i] = choices[0].text; // push partitioned summaries into object
            summaryArr.push(data[0]["parsed_summary_"+i]);
            await new Promise(r => setTimeout(r, 60000));
        }
	await cb(data, summaryArr, o, fi, function(c){
	    c();
	});
    }
    catch(e) {
        if("Error summarizing partitioned data: ", e) throw e;
    }
}

async function finalizeData(d, sArr, o, fi, c) {
    let str = sArr.join("\n").toString();
    const openaiPrompt = fi + "\n" + d[0].document_id + " Compiled Data: " + str;
    console.log("Finalizing data ...");
    try {
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
        const data = d;
        data[0]["final_data_summary"] = choices[0].text;
	console.log("Finalized Data: ", data);
        c(data);
    }
    catch(e) {
        if("Eror finalizing data: ", e) throw e;
    }
}

function runMain() {
    fs.readdir(jsonFolder, (err, files) => {
       if (err) throw err;
       /*files.forEach(async (file) => {
            const filePath = path.resolve(jsonFolder + file);
            let isDirectory = isDir(filePath);
            if(isDirectory === false) {
                console.log("Reading: ", filePath);
                const id = file.split(".")[0]; // grabs the id from file name
                await getResultsByDocument(parser.id, id, filePath, function(data) {
                   main(data, connStr, jsonFolder, filePath, file);
		});
            }
       });*/
       for(const file of files) {
           const filePath = path.resolve(jsonFolder + file);
           let isDirectory = isDir(filePath);
           if(isDirectory === false) {
                console.log("Reading: ", filePath);
                const id = file.split(".")[0]; // grabs the id from file name
                getResultsByDocument(parser.id, id, filePath, function(data) {
                    main(data, connStr, jsonFolder, filePath, file);
		});							               
	   }
       }
    });
}

await runMain();
