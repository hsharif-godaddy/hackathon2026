import { PhoneString } from '@/types/inbox/local/core'

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
