import { BeeClient } from 'bee-client-lib';

class Session {
	initialized: boolean;
	client: any;
	logFunction: any;
	sendMessage: any;
	start: any;

	selfWallet;
	otherWallet;
	tmpWallet;

	selfFeed: undefined;
	otherFeed: undefined;
	sharedFeed: undefined;

	topicSalt;
	secret: undefined;

	constructor(client: BeeClient, selfWallet: any, tmpWallet: any, skipFirst: boolean = false) {
		this.initialized = false;
		this.client = client;
		this.selfWallet = selfWallet;
		this.tmpWallet = tmpWallet;
		this.logFunction = console.debug;
	}

	public async initSession(skipFirst: boolean){
		if (skipFirst) {
			console.log('skip');
			this.sharedFeed = await this.client.addFeed(this.tmpWallet, 1); //new dfeeds.indexed(topic);
		} else {
			this.sharedFeed = await this.client.addFeed(this.tmpWallet); //new dfeeds.indexed(topic);
		}
	}

	// BUG: This won't work until bee-client indexes salted feeds by salt+address
	public async startOtherFeed(topicSalt, other_wallet) {
		this.topicSalt = topicSalt;
		this.selfFeed = await this.client.addFeedWithSalt(topicSalt, this.selfWallet);
		this.otherWallet = other_wallet;
		this.otherFeed = await this.client.addFeedWithSalt(topicSalt, this.otherWallet, 0);
		return true;
	}

	public async sendHandshake() {
		let r = this.client.updateFeed(this.selfWallet.publicKey, this.tmpWallet);
		return r;

	}

	public async getHandshake() {
		return this.client.getFeed(this.tmpWallet);
	}

	public async updateFeed(message: any) {
		return this.client.updateFeedWithSalt(this.topicSalt, message, this.selfWallet);
	}

	public async getOtherFeed() {
		let p = await this.client.getFeedWithSaltAndIncrement(this.topicSalt, this.otherWallet);
		// this._nextFeedIndex();
		return p;
	}

	// HACK until increment is available in lib
	public _nextFeedIndex() {
		let b = this.client.feeds[this.topicSalt][this.otherWallet.address].current();
		this.client.feeds[this.topicSalt][this.otherWallet.address].next();
		let a = this.client.feeds[this.topicSalt][this.otherWallet.address].current();
		console.log('after and before _nextFeedIndex',a,b);
	}

	public setSecret(secret) {
		this.secret = secret;
	}
};

export { Session };
