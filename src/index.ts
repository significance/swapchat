import * as wallet from 'swarm-lowlevel/unsafewallet';
import { hexToArray, arrayToHex, waitUntil, stripHexPrefix } from './common';
import { Session } from './session';
import { BeeClient } from 'bee-client-lib';
import { encryptAesGcm as encrypt } from './crypto';
import { decryptAesGcm as decrypt } from './crypto';
import { hash, derive } from './crypto';

type ManifestCallback = (manifest: string, sharedPrivateKey: string) => void;
type StateCallback = (topicHex: string) => void;

const MSGPERIOD = 1000;

let log = console.log;

function getTmpPrivKey(): any {
	if (typeof window !== 'undefined' && window != null && window.location != null && window.location.search != null && window.location.search.length > 0) {
		const key = window.location.search.slice(1);
		console.debug("using tmpPrivKey from browser: " + key);
		return hexToArray(key);
	}
	// dev cheat for setting other user (2 is first arg after `ts-node scriptname`)
	if (process.argv.length > 2) {
		let tmpPrivKey = process.argv[2];
		tmpPrivKey = stripHexPrefix(tmpPrivKey);
		console.debug("using tmpkey from cli: " + tmpPrivKey);
		return hexToArray(tmpPrivKey);
	}
	return undefined;
}

// the private key of the feed used to inform chat requester about responder user
let keyTmpRequestPriv = getTmpPrivKey();

const selfWallet = new wallet.Wallet();//Buffer.from(hexToArray(privateKeySelf.substring(2)));
console.log('selfWallet private', arrayToHex(selfWallet.privateKey));
console.log('selfWallet public', arrayToHex(selfWallet.publicKey));
console.log('selfWallet address', selfWallet.getAddress());

let tmpWallet = undefined;
if (keyTmpRequestPriv != undefined) {
	tmpWallet = new wallet.Wallet(Buffer.from(keyTmpRequestPriv));
} else {
	tmpWallet = new wallet.Wallet();
}
console.log('tmpWallet', arrayToHex(tmpWallet.privateKey));

// the peer
let otherWallet = undefined;

let topicTmpArray = hash(tmpWallet.privateKey);
// soc definitions warranted 20 byte topicid
topicTmpArray = topicTmpArray.slice(0, 20);
// we could even choose this then
// topicTmpArray = selfWallet.getAddress('binary');
console.log('topic', arrayToHex(topicTmpArray));

// the master session
// let chatSession: Session = undefined;


// if bz is supplied, will update tmp feed
async function connectToPeer(session: any, handshakeOther:any) {
	// set up the user info for the peer
	// and start the chat session with that info
	otherWallet = wallet.newReadOnlyWallet(handshakeOther);
	const secretBytes = await derive(selfWallet.privateKey, otherWallet.publicKey);
	session.setSecret(secretBytes);
	await session.startOtherFeed(secretBytes, otherWallet);
	await session.start(session);
	return otherWallet;
}

async function connectToPeerTwo(session: any, handshakeOther:any) {
	// NB these are globalsss
	console.log(handshakeOther);
	otherWallet = wallet.newReadOnlyWallet(handshakeOther);

	const secretBytes = await derive(selfWallet.privateKey, otherWallet.publicKey);

	session.setSecret(secretBytes);
	await session.startOtherFeed(secretBytes, otherWallet);
	session.sendHandshake();
	await session.start(session);
	return otherWallet;
}

async function checkResponse(session: any):Promise<string|undefined> {
	try {
		const soc = await session.getHandshake();
		return await connectToPeer(session, soc.chunk.data);
	} catch (e) {
		console.error('no response yet...' + e);
		return;
	}
}

// Handle the handshake from the peer that responds to the invitation
async function startRequest(session: Session, manifestCallback: ManifestCallback):Promise<any> {
	session.sendHandshake();
	manifestCallback("", arrayToHex(tmpWallet.privateKey));
	// hack to increment the session index by one
	session.client.feeds[session.tmpWallet.address].index++;
	for (;;) {
		const nextCheckTime = Date.now() + 1000;
		const userOther = await checkResponse(session);
		if (userOther !== undefined) {
			return;
		}
		await waitUntil(nextCheckTime);
	}
}

async function startResponse(session: any):Promise<any> {
	const soc = await session.getHandshake()
	const userOther = await connectToPeerTwo(session, soc.chunk.data);
	return true
}


const newSession = async (gatewayAddress: string, messageCallback: any) => {
	const sendEnvelope = async (envelope) => {
		const envelopeJson = JSON.stringify(envelope)
		console.debug('I would have sent this message', envelope);
	}
	const sendMessage = async (message: string) => {
		const envelope = {
			type: 'message',
			message,
		}
		return sendEnvelope(envelope)
	}
	const sendPing = () => {
		const envelope = {
			type: 'ping',
		}
		return sendEnvelope(envelope)
	}
	const sendDisconnect = () => {
		const envelope = {
			type: 'disconnect',
		}
		return sendEnvelope(envelope)
	}
	const poll = async (session:any) => {
		while (true) {
			try {
				// console.debug('poll', session.otherFeed);
				const soc = await session.getOtherFeed();
				console.debug('got', soc);
				const message = await decrypt(soc.chunk.data, session.secret);
				messageCallback({
					type: 'message',
					message,
				});
			} catch (e) {
				console.log('polled in vain for other...' + e);
				break;
			}
		}
		setTimeout(poll, MSGPERIOD, session);
	}

	const client = new BeeClient(gatewayAddress, {timeout: 100});
	const chatSession = new Session(client, selfWallet, tmpWallet, keyTmpRequestPriv != undefined);
	await chatSession.initSession(keyTmpRequestPriv != undefined);
	chatSession.sendMessage = async (message: string) => {
		const encryptedMessage = await encrypt(message, chatSession.secret);
		let r = await chatSession.client.updateFeedWithSalt(chatSession.secret, encryptedMessage, chatSession.selfWallet);
	};

	chatSession.start = async (session: any) => {
		await poll(session);
	};
	return chatSession;
}

export async function init(params: {
	gatewayAddress: string,
	messageCallback: any,
	manifestCallback: ManifestCallback,
	stateCallback: StateCallback,
	logFunction: (...args: any[]) => void,
}) {
	log = params.logFunction;
	log('init called');

	// TODO: this guy is global. let's pass him around instead, perhaps?
	const chatSession = await newSession(params.gatewayAddress, params.messageCallback);
	if (keyTmpRequestPriv === undefined) {
		log('start request');
		startRequest(chatSession, params.manifestCallback).then(() => {
			let topicHex = arrayToHex(topicTmpArray);
			params.stateCallback(topicHex);
		}).catch((e) => {
			console.error("error starting request: ", e);
			log("error starting request: ", e);
		});
	} else {
		log('start response');
		startResponse(chatSession).then(() => {
			let topicHex = arrayToHex(topicTmpArray);
			params.stateCallback(topicHex);
		}).catch((e) => {
			console.error("error starting response: ", e);
			log("error starting response: ", e);
		});
	}
	return chatSession;
}

export function send(session: Session, message: string) {
	try {
		session.sendMessage(message);
	} catch(e) {
		console.error(e);
	}
}

export function disconnect() {
	try {
		// chatSession.sendDisconnect();
	} catch(e) {
		console.error(e);
	}
}
