import * as crypto from 'crypto'

export interface WebhookHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
}

export interface WebhookConfig {
  secretKey: string;
  toleranceSeconds: number;
  encodeAlg: string;
  digestMethod: crypto.BinaryToTextEncoding;
}

export function resolveWebhookConfig(overrides?: Partial<WebhookConfig>): WebhookConfig {
  const secretKey = overrides?.secretKey ?? process.env.WEBHOOK_SECRET_KEY
  if (!secretKey) {
    throw new Error('Missing webhook signing secret (WEBHOOK_SECRET_KEY)')
  }

  return {
    secretKey,
    toleranceSeconds:
      overrides?.toleranceSeconds ??
      (parseInt(process.env.WEBHOOK_TIMESTAMP_TOLERANCE ?? '', 10) || 5 * 60),
    encodeAlg: overrides?.encodeAlg ?? (process.env.WEBHOOK_ENCODE_ALG || 'sha256'),
    digestMethod:
      overrides?.digestMethod ??
      ((process.env.WEBHOOK_DIGEST_METHOD || 'base64') as crypto.BinaryToTextEncoding),
  }
}

function verifyTimestamp(time: string, toleranceSeconds: number): Date{
  const now = Math.floor(Date.now() / 1000)
  const timestamp = parseInt(time, 10)

  if(isNaN(timestamp) || (now - timestamp > toleranceSeconds) || (timestamp > now + toleranceSeconds)) {
    throw new Error('Invalid signature')
  }

  return new Date(timestamp * 1000)
}

function forgeSignature(id: string, timestamp: Date, payload: string, config: WebhookConfig) {
  const timestampNum = Math.floor(timestamp.getTime() / 1000)
  const signed = `${id}.${timestampNum}.${payload}`
  const expectedSignature = crypto
    .createHmac(config.encodeAlg, config.secretKey)
    .update(signed)
    .digest(config.digestMethod)
  return `v1,${expectedSignature}`
}

export function verifyHeaders (
  headers: WebhookHeaders,
  payload: string,
  config: WebhookConfig
) {
  const id = headers["webhook-id"]
  const timestamp = headers["webhook-timestamp"]
  const signature = headers["webhook-signature"]

  if (!id || !timestamp || !signature){
    throw new Error('Missing headers')
  }

  const verifiedTimestamp = verifyTimestamp(timestamp, config.toleranceSeconds)

  const expected = forgeSignature(id, verifiedTimestamp, payload, config)
  const expectedSig = Buffer.from(expected.split(',')[1])
  const actualSig = Buffer.from(signature.split(',')[1])

  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)){
    throw new Error('Signature mismatch')

  }
}
