/**
 * Masks a name or email for leaderboard privacy.
 * Example: "Lawrence Cortez" -> "Law****ce Cor**z"
 * Example: "john.doe@gmail.com" -> "joh****oe@gm**l.com"
 */
export function maskName(nameOrEmail?: string | null): string {
  if (!nameOrEmail) return 'Ano****us'

  // If it's an email address
  if (nameOrEmail.includes('@')) {
    const [local, domain] = nameOrEmail.split('@')
    const maskedLocal = maskWord(local)
    const domainParts = (domain || 'gmail.com').split('.')
    const maskedDomain = domainParts
      .map((p, i) => (i === domainParts.length - 1 ? p : maskWord(p)))
      .join('.')
    return `${maskedLocal}@${maskedDomain}`
  }

  // If it's regular names (e.g. Lawrence Cortez)
  const words = nameOrEmail.trim().split(/\s+/)
  return words.map(maskWord).join(' ')
}

function maskWord(word: string): string {
  if (!word) return ''
  const len = word.length
  if (len <= 2) return word[0] + '*'
  if (len === 3) return word[0] + '*' + word[2]
  if (len === 4) return word.slice(0, 2) + '*' + word.slice(-1)
  if (len <= 6) return word.slice(0, 3) + '**' + word.slice(-1)
  // 7+ characters: e.g. Lawrence (8) -> Law****ce
  return word.slice(0, 3) + '****' + word.slice(-2)
}
