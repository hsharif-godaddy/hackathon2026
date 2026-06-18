import { Optional, PhoneString } from '@/types/inbox/local/core'

// [!] "phone-like" string could include digits, whitespace, '+', '-', '(', ')', '.'
// digits count should be 10 or 11
const phoneLike = /^[+\d\s()\-.]{10,}$/

// https://developers.google.com/style/phone-numbers
export const tryFormatAsUSPhone = (phone: PhoneString): string => {
  if (!phoneLike.test(phone)) return phone
  const digits = phone.replace(/\D/g, '')
  // [!] E.164 phone number pattern with length 10 (without prefix) doesn't work for some countries like UK and Brazil
  if (digits.length === 10)
    return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6, 10)}`
  if (digits.length === 11 && digits[0] === '1')
    return `(${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.substring(7, 11)}`
  if (digits.length === 11)
    return `+${digits[0]} ${digits.substring(1, 4)} ${digits.substring(4, 7)} ${digits.substring(7, 11)}`
  return phone
}

// Validates a US/NANP number and returns it in E.164 form (e.g. '+14805551234'),
// or undefined if invalid. Replaces libphonenumber-js's parsePhoneNumber(...).number.
export const validatePhoneNumber = (value: string): Optional<PhoneString> => {
  const digits = value.replace(/\D/g, '')
  const national = digits.length === 11 && digits[0] === '1' ? digits.substring(1) : digits
  // [!] NANP rule: both the area code and the central-office (exchange) code must begin 2-9
  if (national.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return undefined
  return `+1${national}`
}

// Matches a NANP-style phone number. The leading `(?:^|\D)` replaces a `(?<!\d)`
// lookbehind: lookbehind is unsupported in Safari < 16.4, where the regex *literal*
// throws a SyntaxError at parse time and takes down the whole module. Requiring the
// number to begin at the start of the text or after a non-digit gives the same
// guarantee (a candidate is never matched mid-digit-run). The number itself is capture
// group 1; the boundary char stays outside the group so the caller emits it as
// surrounding text rather than absorbing it into the link.
export const getPhoneRegex = () => /(?:^|\D)(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/g;
