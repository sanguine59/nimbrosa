import * as crypto from 'crypto'

interface WebhookHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
}

const TOLERANCE = parseInt(process.env.WEBHOOK_TIMESTAMP_TOLERANCE ?? '', 10) || 5 * 60
const key = process.env.WEBHOOK_SECRET_KEY
if(!key) throw new Error('Missing WEBHOOK_SECRET_KEY')
const ENCODE_ALG = process.env.WEBHOOK_ENCODE_ALG || 'sha256'
const DIGEST_METHOD = (process.env.WEBHOOK_DIGEST_METHOD || 'base64') as crypto.BinaryToTextEncoding

function verifyTimestamp(time: string): Date{
  const now = Math.floor(Date.now() / 1000)
  const timestamp = parseInt(time, 10)

  if(isNaN(timestamp) || (now - timestamp > TOLERANCE) || (timestamp > now + TOLERANCE)) {
    throw new Error('Invalid signature') 
  }
  
  return new Date(timestamp * 1000)
}

function forgeSignature(id: string, timestamp: Date, payload: string) {
  const timestampNum = Math.floor(timestamp.getTime() / 1000)
  const signed = `${id}.${timestampNum}.${payload}`
  const expectedSignature = crypto.createHmac(ENCODE_ALG, key as string).update(signed).digest(DIGEST_METHOD)
  return `v1,${expectedSignature}`
}

function verifyHeaders (
  headers: WebhookHeaders,
  payload: string
) {
  const id = headers["webhook-id"]
  const timestamp = headers["webhook-timestamp"]
  const signature = headers["webhook-signature"]

  if (!id || !timestamp || !signature){
    throw new Error('Missing headers')
  }

  const verifiedTimestamp = verifyTimestamp(timestamp)

  const expected = forgeSignature(id, verifiedTimestamp, payload)
  const expectedSig = Buffer.from(expected.split(',')[1])
  const actualSig = Buffer.from(signature.split(',')[1])

  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)){
    throw new Error('Signature mismatch')

  }
}
