import { buildApp } from './app.js'
import { loadEnv } from './env.js'

const env = loadEnv()
const app = buildApp(env)

try {
  await app.listen({ host: env.host, port: env.port })
  console.log(`AniFlow listening on http://localhost:${env.port}`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
