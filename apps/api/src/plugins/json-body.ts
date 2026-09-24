import type { FastifyInstance } from "fastify"

/**
 * JSON bodies, where an empty body means "no body".
 *
 * Plenty of HTTP clients set `Content-Type: application/json` on every request
 * — including a DELETE that carries nothing. Fastify's default parser rejects
 * that with 400 FST_ERR_CTP_EMPTY_JSON_BODY before routing or authentication
 * run, so an integration's delete failed with an error about a body it never
 * meant to send. An empty body now parses to `undefined`; routes that need a
 * body still reject it through their own validation.
 *
 * Everything else goes to Fastify's own parser, so its prototype- and
 * constructor-poisoning protection is unchanged.
 */
export function registerJsonBodyParser(fastify: FastifyInstance) {
  const defaultParser = fastify.getDefaultJsonParser("error", "error")
  fastify.removeContentTypeParser("application/json")
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const text = typeof body === "string" ? body : body.toString("utf8")
      if (text.trim() === "") {
        done(null, undefined)
        return
      }
      defaultParser(request, text, done)
    },
  )
}
