import fs from 'fs';
import process from 'dotenv'
import path from 'path';
import mongodb from 'mongodb';
import { Configuration, OpenAIApi } from 'openai';
const __dirname = path.dirname('.');
console.log("Working Directory: ", __dirname)
const env = process.config({path: path.resolve('.env')});
console.log(env);
const fsFolder = env.parsed.FSEOBFOLDER;
const configuration = new Configuration({
	    apiKey: env.parsed.OPENAIAPIKEY,
	    echo: false
});

const openai = new OpenAIApi(configuration);
const connStr = env.parsed.CONNECTION_STRING;
const doc1 = "bbb7224f649bd6dfc2244829cdc21c96";
const eobModel = env.parsed.EOBAIMODEL001 ? env.parsed.EOBAIMODEL001 : env.parsed.EOBAIMODEL001_2;

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

async function getMongoData(cStr) {
            let data = { 
		rawData: "",
		responseData: "",
	        pageCount: 0
	    }
	    console.log("Connecting to MongoDB: ", cStr);
	    const client = new mongodb.MongoClient(cStr);
	    try {
	         await client.connect();
                 const db = await client.db("Steelgem");
                 console.log("Database: ", db.databaseName);
                 const rc = await db.collection("EOB");
                 console.log("Collection: ", rc.collectionName);
                 const query = { document_id: doc1 };
                 await rc.findOne(query).then(function (result){
                 	//console.log(result);
			data["rawData"] = result["data"];
			data["responseData"] = result["data_report"];
			data["pageCount"] = result["page_count"];
		 	//console.log("Data: ", data);
	        }).catch(err => console.log(err));
	    }
	    catch(err) {
	           console.log(err);
            }
	    finally {
		    await client.close();
		    return data;
	    }
}

const instructions = "<instructions>\n0) Perform the following tasks on the data enclosed in '<data>' ending with '</data>' (DO NOT include or regurgitate any of the '<instructions>' in your response nor provide any feedback regarding actions taken. Evaluate instructions 1,2,3,4,5 and respond only to instruction 6):\n1) Tokenize each word and assign numerical values to each word to create relationships within the <data> and to create a vector representations of each word to aid in semantic searching of the text. Identify key and value pairings and recoginize tables in the form of running text that is made up of column headers followed by rows of data. \n2) Search for key terms belonging to an insurance policy, insurance claim, explanation of benefits, remittance advice and or patient information. Then extract information such as payee, medical provider, claim number or id, authorization number, code or status, patient name, patient id, dates, services, charges, totals and or balances, and insurance policy id or member id and etc to create a record suitable for a SQL database. Each record must have the following fields: provider and or provider id, payee and or payee id, claim number or id, authorization status, code and or number, insurance policy id or member id, dates of service, charges, totals and or balances, patient name and or patient id. Records can be grouped under the same patient name, patient id and or insurance policy number or member id.\n3) Classify each record as either an explanation of benefits, remittance advice or reimbursement (overpay).\n4) For any policy, briefly summarize the policy, highlighting grace periods, coverage, and or appeals. Disregard any legalities, prohibits and or disclosures.\n5) Validate and summarize your work by answering the following questions: How many claim items or patient records are there and what are their IDs and or authorization codes? Has the claim been denied or approved? Who are the payers and how much do they each owe and or are there any outstanding balances? Who are the payees and providers and are there any requirements needed to be resolved? Lastly when was the claim sent or when was the claim received?\n6)Only return the records created or if no record exists return a summary of the data in your response.\n</instructions>\n\n";

async function createEOBTrainingFile_1(dt, ins){
     try {
		let data = dt["rawData"];
		let respData = dt["responseData"];
		let pgCount = dt["pageCount"];
		let divisor1 = (Number(data.length) / Number(pgCount)).toFixed(0);
		let divisor2 = (Number(respData.length) / Number(pgCount)).toFixed(0);
		var dataArr = [];
		var respArr = [];
		var trainData = [];
		if(pgCount > 1) {
 	            dataArr = splitParagraph(data, divisor1);
		    respArr = splitParagraph(respData, divisor2);
		}	
		else {
	     	    dataArr.push(data);
	     	    respArr.push(respData);
		}
		console.log(dataArr.length, respArr.length);
		if(dataArr.length === respArr.length) {
		     for(var i = 0; i < dataArr.length; i++) {
			let json = {
		    	"prompt": ins + "<data>\n" + dataArr[i] + "\n</data>",
		    	"completion": respArr[i]
			};
			trainData.push(json);
	     		}
             	let trainingDataString = trainData.map(x=>JSON.stringify(x)).join("\n");
	     	try {
                 fs.writeFileSync(fsFolder + "fine_tune/eobTrainingFile_1.jsonl", 
				trainingDataString);
		 console.log("Saved eobTrainingFile_1.jsonl");
	    	} catch (err) {
			console.error("Error writing eobTrainingFile_1.jsonl", err);
	     	}
	    	console.log("Uploading eobTrainingFile_1.jsonl to OpenAI ...");
	    	const response = await openai.createFile(
	    		fs.createReadStream(fsFolder + "fine_tune/eobTrainingFile_1.jsonl"), 
		    	"fine-tune");
	    	console.log("Created EOB Open AI training file 1:", response.data.id);
	        return response;
	    }
     }
     catch (e) {
	console.log(e);
     }
}

async function createEOBTrainingFile_2() {
	const ins = "<instructions>\n0) Perform the following tasks on the data enclosed in '<data>' ending with '</data>' (DO NOT include or regurgitate any of the <instructions> as part of your response nor provide any feedback regarding actions taken. Evaluate instruction 1 and respond only to instruction 2):\n1) Create an embedding of the data to use as a look up table to parse and transform any claim or patient record into a proper JSON object. The following fields are required and must be present within the JSON object: classification, medical provider, payee, claim id or number, authorization code and or number, patient name, patient id, insurance policy number or member id, totals, charges, and or balances, dates of service and claim status or authorization status.\n2)Return only the JSON object or objects in your response.</instructions>\n\n";;
	const data = ['\n' +
	    '\n' +
	    'Records created: \n' +
	    '1. Claim Number or ID: DE90008507 0054860135 \n' +
	    'Authorization Code: N/A\n' +
	    'Status and or Number: P1341 \n' +
	    'Insurance Policy ID or Member ID: 970394925  \n' +
	    'Dates of Service: 12/17/21 - 12/17/21 \n' +
	    'Charges: $2,000.00 \n' +
	    'Totals or Balances: $0.00  \n' +
	    'Patient Name and or Patient ID: Thomas Tabuso (CH)   \n' +
	    'Classification of Record: Remittance Advice \n' +
	    '\n' +
	    'Summary of Data: There is one record created related to this data. The claim number or id is DE90008507 0054860135, authorization code is N/A, status and or number is P1341, insurance policy id or member id is 970394925, dates of service are 12/17/21 - 12/17/21, charges are $2,000.00 ,totals and balances are $0.00 ,patient name and patient id are Thomas Tabuso (CH). The classification of the record is remittance advice. The payee name for this claim is Sagebrush Trace Number TV 175064461810 E Chapman Ave Ste 180 Fullerton CA 92831. Payment for the claim was $0 due to a payer initiated reduction-claim specific negotiated discount applied to the amount billed by an out-of network provider who accepted a discount based on a fee negotiated with MultiPlan / Viant .', '\n' +
    '\n' +
    'Records created: \n' +
    '1. Claim Number or ID: DD84638547 Authorization Code: 0270001594 Status and/or Number: Payment of Benefits Payer Amount Owed: $0.00 Payee Provider Name: Sagebrush Patient Name: Eleasha Lawrenson Dates of Service: 01/07/22 - 01/21/22 Charges : $2,000.00 Balances : $0.00 Insurance Policy ID or Member ID : A 8295277393 Date Sent : N/A Date Received : 01/31/22\n' +
    '\n' +
    '2. Claim Number or ID: DE36791884 Authorization Code : 0081981640 Status and/or Number : Payment of Benefits Payer Amount Owed : $0.00 Payee Provider Name : M Higgins MA Patient Name : Eleasha Lawrenson Dates of Service  01/21/22 - 01 /21 / 22 Charges  $2,000.00 Balances  $0.00 Insurance Policy ID or Member ID  A 8295277393 Date Sent   N / A Date Received   02 / 04 / 22']
	const resp = [ 
	    {
	      Claim_Number_or_ID: 'DE94090303 0054860146',
	      Authorization_Code: 'ND 02/08/22',
	      Status_and_or_Number: 'PR242',
	      Insurance_Policy_ID_or_Member_ID: 'A 967034468',
	      Dates_of_Service: '02/05/22 - 02/05/22',
	      Charges: 2000,
	      Totals_or_Balances: 1959.06,
	      Patient_Name: 'Thomas Tabuso',
	      Patient_ID: 970738800,
	      Claim_Status: 'Approved'
	    },[{
	        claim_id: 'DD84638547',
	        authorization_code: '0270001594',
	        status_number: 'Payment of Benefits',
	        payer_amount_owed: '$0.00',
	        payee_provider_name: 'Sagebrush',
	        patient_name: 'Eleasha Lawrenson',
	        dates_of_service: '01/07/22 - 01/21/22',
	        charges: '$2,000.00',
	        balances: '$0.00',
	        insurance_policy_id: 'A 8295277393',
	        date_sent: 'N/A',
	        date_received: '01/31/22'
	      },
	      {
	        claim_id: 'DE36791884',
	        authorization_code: '0081981640',
	        status_number: 'Payment of Benefits',
	        payer_amount_owed: '$0.00',
		payee_provider_name: 'Sagebrush',
		patient_name: 'Eleasha Lawrenson',
		dates_of_service: '01/21/22 - 01 /21 / 22',
	        charges: '$2,000.00',
	        balances: '$0.00',
	        insurance_policy_id: 'A 8295277393',
	        date_sent: 'N/A',
	        date_received: '02/04/22'
	      }]];
	var trainData = [];
	if(data.length === resp.length) {
	    for(var i = 0; i < data.length; i++) {
		        let json = {
	        	   "prompt": ins + "<data>\n" + data[i] + "\n</data>",
		           "completion": JSON.stringify(resp[i])
		        };
	    		trainData.push(json);
	    	}
		let trainingDataString = trainData.map(x=>JSON.stringify(x)).join("\n");
		try {
	            fs.writeFileSync(fsFolder + "fine_tune/eobTrainingFile_2.jsonl",
                             trainingDataString);
        	    console.log("Saved eobTrainingFile_2.jsonl");
	        } catch (err) {
        	    console.log("Error writing file eobTrainingFile_2". err);
	        }
        	    console.log("Uploading eobTrainingFile_2.jsonl to OpenAI ...");
		try {	
            		const response = await openai.createFile(
		        fs.createReadStream(fsFolder + "fine_tune/eobTrainingFile_2.jsonl"),"fine-tune");		                
		        console.log("Created EOB Open AI training file 2: ", response.data.id);
	        	return response;
		}
		catch(e) {
		console.log("Error uploading training file 2: ", e);
		}
    	}
}

async function createEOBTrainingFile_3() {
	const response = await openai.createFile(
		            fs.createReadStream(fsFolder + "fine_tune/eobTrainingFile_3.jsonl"),
                            "fine-tune");
       console.log("Created EOB Open AI training file 3: ", response.data.id);
       return response;
}

async function getTrainingFiles() {
    try {
	const files = await openai.listFiles();
	console.log("Tuning files: ", files["data"]["data"]);
        return files["data"]["data"];
    }
    catch (e) {
	console.log("Error retrieving training files!");
    }
}

async function createTuningJob() {
     try {
	//const mongoData = await getMongoData(connStr);		
	//const eobTrainingFile_1 = await createEOBTrainingFile_1(mongoData, instructions);
	/*const response1 = await openai.createFineTune({
	        training_file: eobTrainingFile_1["data"]["id"],
		model: eobModel ? eobModel : "davinci",
		suffix: "steelgem-eob-001"
        });
	const eobTrainingFile_2 = await createEOBTrainingFile_2();
        const response2 = await openai.createFineTune({
                training_file: eobTrainingFile_2["data"]["id"],
                model:  "davinci",
                suffix: "steelgem-eob-002"
        });*/
	const eobTrainingFile_3 = await createEOBTrainingFile_3();
        const response3 = await openai.createFineTune({
                  training_file: eobTrainingFile_3["data"]["id"],
		  //model:  "davinci",
		  //suffix: "steelgem-eob-003"
		  fine_tuned_model: eobModel 
	});
     }
     catch (e) {
	console.log("Error creating tune job", e);
     }
}

async function clearTunes(m, i) {
	const model = m ? m : null;
	const id = i;
	const fineTunes = await getFineTunes();
	for(var i = 0; i < fineTunes.length; i++) {
		if(m !== null) {
			if(fineTunes[i].fine_tuned_model !== model 
				&& (fineTunes[i].status !== "succeeded"
				&& fineTunes[i].status !== "cancelled")) {
          		    const response = await openai.cancelFineTune(fineTunes[i].id);
			    console.log("Cancelled tune job: ", response);
			}
			if(fineTunes[i].fine_tuned_model !== model
			   && fineTunes[i].status === "succeeded") {
			    console.log("Found other fined tuned model: ", 
			     	          fineTunes[i].fine_tuned_model);
			}
		}
		else {
			if(fineTunes[i].id !== id 
				&& (fineTunes[i].status !== "succeeded"
				&& fineTunes[i].status !== "cancelled")) {
      			    const response = await openai.cancelFineTune(fineTunes[i].id);
			    console.log("Cancelled tune job: ", response);
			}
			if(fineTunes[i].id !== id && fineTunes[i].status === "succeeded") {
				//const response = await openai.deleteModel(fineTunes[i].model);
                                //console.log("Deleted fine tuned model: ", response);
			     console.log("Found other fined tuned model: ", 
				     fineTunes[i].fine_tuned_model);
			}
		}
	}
}

async function getFineTunes() {
	const fineTunes = await openai.listFineTunes();
	console.log("List of Fine Tunes: ", fineTunes["data"]["data"]);
	return fineTunes["data"]["data"];
}

async function main() {
	try {
		//console.log("Clearing fine tune jobs");
		//await clearTunes(eobModel,'ft-GiW3Olwbk3C72CYuYU2IPqWA');
		//console.log("Creatomg tuning job ...");
		//await createTuningJob();
		//console.log("Getting fine tune jobs ...");
		//await getFineTunes();
		console.log("Getting models");
		const response = await openai.listModels();
		console.log(response["data"]);
	}catch(e) {
		if(e) throw ("Error on main: " + e);
	}
}

main();
