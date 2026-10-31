// Copy-paste examples for POST /intake/:workspaceId. Bodies follow intakeSchema from @leadpilot/shared.

const KEY_PLACEHOLDER = 'YOUR_INTAKE_KEY'

export function curlSnippet(endpoint: string): string {
  return `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Intake-Key: ${KEY_PLACEHOLDER}' \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "name": "Jane Cooper",
    "email": "jane@example.com",
    "company": "Acme Inc",
    "phone": "+1 555 0100",
    "jobTitle": "Head of Operations",
    "website": "https://acme.example",
    "source": "website_form",
    "message": "We need a customer portal connected to our CRM."
  }'`
}

export function htmlSnippet(endpoint: string): string {
  return `<form id="lead-form">
  <input name="name" required placeholder="Name" />
  <input name="email" type="email" required placeholder="Email" />
  <input name="company" required placeholder="Company" />
  <textarea name="message" required minlength="10" placeholder="How can we help?"></textarea>
  <!-- Honeypot: hidden from people, left empty. Bots that fill it are ignored. -->
  <input name="hp" type="text" tabindex="-1" autocomplete="off"
         style="position:absolute;left:-9999px" aria-hidden="true" />
  <button type="submit">Send</button>
</form>
<script>
  document.getElementById('lead-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    const res = await fetch('${endpoint}', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Prefer calling from your own backend so the key is not exposed in page source.
        'X-Intake-Key': '${KEY_PLACEHOLDER}',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ ...data, source: 'website_form' }),
    })
    if (!res.ok) console.error('Lead submission failed', res.status)
  })
</script>`
}
