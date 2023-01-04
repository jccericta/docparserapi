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
    console.log('Connection to DocParser API established.');
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
// const pattern = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'i')

/* split by the first char then grab the second element which should be the rest substring of str minus the first char*/
async function recParse(str) {
	try {
		let j = JSON.parse(str);
		if(typeof j === 'object') {
			console.log("Parsed data_json: ", j);
			return await j;
		}
	}
	catch(e) {
		if(e) {
			if(str && str.length > 0) {
				//console.log(str);
				var s = str.slice(1); 
				return await recParse(s);
				} 
				else {
					return await false;
				}
			}
		}
}

async function getResultsByDocument(parserId, docId, file, callback) {
    await client.getResultsByDocument(parserId, docId, {format: 'object'})
    .then(function (res) {
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

// Connect to mongodb and ingest the data to EOB.Steelgem database
async function main(data, cStr, j, fp, f) {
    console.log("Connecting to MongoDB: ", cStr);
    const client = new mongodb.MongoClient(cStr);
    try {
        await client.connect();
        const db = await client.db("Steelgem");
        console.log("Database: ", db.databaseName);
        const rc = await db.collection("EOB");
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

/* 					THE PROMPT					          */

const openai = new OpenAIApi(configuration);

const prompt = "<Instructions> \n Instruction 1) Clear your cache, your memory and create a log file: '<logFileName>', cache and save into your memory the log file: '<logFileName>' for referencing. Read the following data marked as '<Data>' ending with '</Data>' vertically top to bottom, left to right as if it was an invoice. Clean, edit and refine the data by stripping off trailing whitespaces, characters, symbols, and repeating characters. Fix all misspellings and grammatically correct sentences. Take note of patterns such as Claim ID, Patient ID, Date of Service, Insurance Policy Number and etc. Log, cache and save the refined data into your memory under '<Refined Data>' ending with '</Refined Data>'. Create a reference to the '<Refined Data>' and log it in the log file for further referencing. Do this for all subsequent data in <data> grouped by Document ID. \n\ "

const parse = "Instruction 2) Use the '<Refined Data>' reference found in the log file: <logFileName> to create an embedding of the '<Refined Data>' and classify each chunk of data as an 'Explanation of Benefits', A 'Remittance' or 'Remittance Advice', a 'Reimbursement', a 'Policy', a 'Claim' or General Information. Log and cache the embedding and classifications of the data under '<Classifications>' ending with '</Classifications>' and save into your memory to help with further analysis. Then create a reference to the '<Classifications>' and log it into the log file: <logFileName> for future reference. \n ";

const classify = "Instruction 3) Use the '<Classifications>' and '<Refined Data>' references in the log file: <logFileName> to help you parse the '<Refined Data>' into a record suitable for a tabular database. Create a record for each patient and using the following fields (must be included): 'Payee', 'Provider', 'Reference ID', 'Claim ID' or 'Claim Number', 'Date of Service', 'Authorization Status' or 'Authorization Code', 'Patient Name', 'Insurance Policy Number' or 'Insurance ID', 'Total Charges or Balances', 'Checking Account or Check Number', and 'Notes'. Log and cache each record under '<Records>' ending with </Records> and save into your memory. Then create a reference for each record in '<Records>' and log it into the log file: <logFileName>. \n ";

const summary = "Instruction 4) Validate each record in 'Records'. Use all the the data and saved results found in the log file: <logFileName>, cache and in your memory using the reference pointers found in the log file: <logFileName> for validation and reference. Each record must have a confidence level of 100%. You must include the confidence level for every record. Be consistent with the structure of the record and focus on accuracy above all else. Return the validated record as your completion. Do not regurgitate the '<Instructions>'. \n"; 

const constraints = "Instruction 5) Ensure that the data and information stored in the log file: <logFileName>, cache and in your memory are retrievable outside the scope of the API request by using the log file: <logFileName> to find references to the data. Ensure that each completion is 100% complete. Log, cache and save into your memory all your completions under '<Completions>' ending with </Completions>. \n </Instructions>. \n\n <Data> \n ";

const instructions = prompt + parse + classify + summary + constraints; //add the data later

const finalInstructions = "<Instructions> \n Final Instruction) Retrieve the log file: '<logFileName>' and use the references to find all the data saved in the log file: <logFileName>, cache and in your memory. Find all the completions in '<Completions>' and turn each completion into a JSON object. Be consistent with the structuring of the JSON object. Return only the JSON object as your 'final completion'. \n </Instructions> \n\n ";

// Splits the unparsed data into equal substrings in length
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

// Summarizes the partitioned unparsed data into parsed data sets
async function summarizeData(d, o, ins, fi, cb) {
    const data = d;
    //console.log("Raw Data", data[0].data);
    let constructs = ins.replaceAll("<logFileName>", data[0].file_name + "." + data[0].document_id);
    //console.log("The construct: ", constructs);
    let pgCount = data[0].page_count;
    let divisor = (Number(data[0].data.length) / Number(pgCount)).toFixed(0);
    var dataArr = [];
    if(divisor > 1) {
	// partition the unparsed data into equal
        dataArr = splitParagraph(data[0].data, divisor); 
    }
    else {
	dataArr.push(data[0].data);
    }
    const summaryArr = [];
    dataArr[0] = constructs + dataArr[0];
    dataArr[dataArr.length -1 ] = dataArr[dataArr.length - 1] + "\n </Data> \n\n";
    console.log("Partitioning the data ...");
    try {    
        for(var i = 0; i < dataArr.length; i++) {
            const openaiPrompt = "(Document ID: " + data[0].document_id + " Data Chunk) \n" + dataArr[i] + " \n ";
            const response = await o.createCompletion({
                model: "text-davinci-003",
                prompt: openaiPrompt,
                temperature: 0.777,
                max_tokens: 327,
                top_p: 1,
                best_of: 27,
                frequency_penalty: 0.87,
                presence_penalty: 0.327,
            });
            const findings = response.data;
            const choices = findings.choices;
            console.log("Summarizing data: ", i)
	    console.log(choices);
            let dt = choices[0].text;
            data[0]["data_"+i] = dt; // push partitioned summaries into object
            summaryArr.push(dt);
            console.log("Waiting 30 seconds before proceeding ...");
            await new Promise(r => setTimeout(r, 30000));
        }
	await cb(data, summaryArr, o, fi, function(c){
	    c();
	});
    }
    catch(e) {
        if(e) throw e;
    }
}

// Collects all the partitioned data and create a report on it
async function finalizeData(d, sArr, o, fi, c) {
    const data = d;
    let str = sArr.join("\n");
    let finalConstruct = fi.replaceAll("<logFileName>", data[0].document_id);
    const openaiPrompt = "<data> \n\n " + str + finalConstruct;
    //console.log("The final construct", finalConstruct);
    console.log("Finalizing data ...");
    try {
        const response = await o.createCompletion({
            model: "text-davinci-003",
            prompt: openaiPrompt,
            temperature: 0.327,
            max_tokens: 420,
            top_p: 1,
            best_of: 27,
            frequency_penalty: 0.18496,
            presence_penalty: 0.136,
        });
        const findings = response.data;
        const choices = findings.choices;
	console.log(choices);
	data[0]["data_report"] = str;
        data[0]["data_json"] = choices[0].text;
	data[0]["data_json"] = recParse(data[0]["data_json"]) ? recParse(data[0]["data_json"]) : data[0]["data_json"]);
	console.log("Finalized Data: ", data);
        await c(data);
    }
    catch(e) {
        if(e) throw e;
    }
}

async function runMain() {
       const files = fs.readdirSync(jsonFolder);
       for(var i = 0; i < files.length; i++) {
	   const filePath = path.resolve(jsonFolder + files[i]);
           let isDirectory = isDir(filePath);
           if(isDirectory === false) {
                console.log("Reading: ", filePath);
		const doc = fs.readFileSync(filePath, 'utf8');
		const jData = JSON.parse(doc);
		var id = '';
		if(jData[0]) {
			id = jData[0]["document_id"] ? jData[0]["document_id"] : jData["id"];
		}
		else{
			id = jData["id"];
		}
		await getResultsByDocument(parser.id, id, filePath, function(data) { 
	 	    const file_name = data.file_name.replace(".pdf", "." + id + ".json");	 
                    main(data, connStr, jsonFolder, filePath, file_name);
	   	});
		console.log("Waiting 1 minute before next file ...");   
		await new Promise(r => setTimeout(r, 60000));
		//await wait("Waiting for 1 minute before next file ...", 60000);
       	    }
	}
}

function resolveAfterXMin(v,x) {
	return new Promise((resolve) => {
		console.log(v)
		setTimeout(() => {
			resolve();
		}, x);	
	});
}

async function wait(v,x) {
	try {
	    let msg = await resolveAfterXMin(v, x);
	    console.log(msg);
            return msg;
	}
	catch (err){
	   if (err) throw err;	
	}
}

function waitSync(ms) {
	const start = Date.now();
	let now = start;
        while ( (now - start) < ms ) { now = Date.now(); }
}

runMain();
