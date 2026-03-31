const upperKeys = [
  '79',
  '7a',
  '7b',
  '7c',
  '7d',
  '7e',
  '7f',
  '70',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '77',
  '68',
  '69',
  '6a',
  '6b',
  '6c',
  '6d',
  '6e',
  '6f',
  '60',
  '61',
  '62',
]
const lowerKeys = [
  '59',
  '5a',
  '5b',
  '5c',
  '5d',
  '5e',
  '5f',
  '50',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '48',
  '49',
  '4a',
  '4b',
  '4c',
  '4d',
  '4e',
  '4f',
  '40',
  '41',
  '42',
]
const digitKeys = ['08', '09', '0a', '0b', '0c', '0d', '0e', '0f', '00', '01']
const punctuationMap = new Map<string, string>([
  ['15', '-'],
  ['16', '.'],
  ['67', '_'],
  ['46', '~'],
  ['02', ':'],
  ['17', '/'],
  ['07', '?'],
  ['1b', '#'],
  ['63', '['],
  ['65', ']'],
  ['78', '@'],
  ['19', '!'],
  ['1c', '$'],
  ['1e', '&'],
  ['10', '('],
  ['11', ')'],
  ['12', '*'],
  ['13', '+'],
  ['14', ','],
  ['03', ';'],
  ['05', '='],
  ['1d', '%'],
])

const decodeMap = new Map<string, string>()
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((char, index) => decodeMap.set(upperKeys[index], char))
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((char, index) => decodeMap.set(lowerKeys[index], char))
'0123456789'.split('').forEach((char, index) => decodeMap.set(digitKeys[index], char))
for (const [key, value] of punctuationMap.entries()) {
  decodeMap.set(key, value)
}

export function decodeAllAnimeSourceUrl(sourceUrl: string): string {
  if (!sourceUrl.startsWith('--')) {
    return sourceUrl
  }

  let decoded = ''

  for (let index = 2; index < sourceUrl.length; index += 2) {
    const token = sourceUrl.slice(index, index + 2)
    decoded += decodeMap.get(token) ?? ''
  }

  return decoded.replace('/clock', '/clock.json')
}
