import React, { ReactElement } from 'react';

import { PhoneLink } from '@/app/[market]/develop/components/preview/inbox/PhoneLink';
import { getPhoneRegex, validatePhoneNumber } from './phone';

// simple and parse the majority of urls
// https://mathiasbynens.be/demo/url-regex

const urlRegexForFormatting = /(https?:\/\/|www\.)[^\s/$.?#].[^\s]*/gim;

type RegexifyParams = {
  pattern: RegExp;
  decorator: (match: string, index: number) => (string | ReactElement);
  input: string;
  // Which capture group is the text to decorate (default 0, the full match). A regex
  // that consumes a leading boundary char outside the captured group (e.g. the phone
  // regex's `(?:^|\D)`) sets this to 1 so the boundary is emitted as surrounding text
  // instead of being decorated.
  matchGroup?: number;
};

// Splits `input` on every match of `pattern`, keeping the text between matches as
// strings and replacing each match with `decorator(match, matchIndex)`. Replaces the
// `regexify-string` package. `pattern` must be global; matchAll clones it internally,
// so the caller's regex (and its `lastIndex`) is never mutated.
const regexifyString = ({ pattern, decorator, input, matchGroup = 0 }: RegexifyParams): (string | ReactElement)[] => {
  const result: (string | ReactElement)[] = [];
  let lastIndex = 0;
  let matchIndex = 0;
  for (const match of input.matchAll(pattern)) {
    const fullStart = match.index ?? 0;
    const matchedText = match[matchGroup];
    // The decorated group is a suffix of match[0]; any leading boundary chars precede it
    // and fall into the substring below so they render as plain surrounding text.
    const matchStart = fullStart + (match[0].length - matchedText.length);
    if (matchStart !== lastIndex) {
      result.push(input.substring(lastIndex, matchStart));
    }
    result.push(decorator(matchedText, matchIndex));
    lastIndex = fullStart + match[0].length;
    matchIndex += 1;
  }
  if (lastIndex < input.length) {
    result.push(input.substring(lastIndex));
  }
  return result;
};

type FormatterInput = string | (string | ReactElement)[];

const regexApplicator = (
  inputText: FormatterInput,
  regex: RegExp,
  returnFormat: (match: string, index: number) => (string | ReactElement),
  matchGroup = 0
): (string | ReactElement)[] => {
  if (!Array.isArray(inputText)) {
    return regexifyString({ pattern: regex, decorator: returnFormat, input: inputText, matchGroup });
  }
  // Only re-tokenize the plain-text segments; ReactElements produced by an earlier
  // formatter are atomic and must pass through untouched (otherwise the later formatter
  // strips them — regexifyString can only split strings). `keyOffset` keeps the index
  // passed to the decorator unique across tokens, since regexifyString resets its own
  // matchIndex to 0 per token — without it, two matches in separate segments collide on
  // the same React key.
  let keyOffset = 0;
  return inputText.flatMap((token) =>
    typeof token === 'string' ?
      regexifyString({ pattern: regex, decorator: (match) => returnFormat(match, keyOffset++), input: token, matchGroup }) :
      [token]);
};

const urlRegexResult = (text: FormatterInput) => {
  const format = (match: string, index: number) => {
    // if the user doesnt include a protocol, force https so it opens on a new site, but present the user with the original text still
    const url = match.includes('://') ? match : 'https://' + match;
    return (
      <React.Fragment key={ `url-${index}` }>
        <a href={ url } className='underline' target='_blank' rel='noreferrer noopener'>{match}</a>
      </React.Fragment>
    );
  };
  return regexApplicator(text, urlRegexForFormatting, format);
};

const emailRegexResult = (text: FormatterInput) => {
  const findEmailInTextRegex = /(^|\b)[a-zA-Z0-9.!#$%&'*+\\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/gim;
  const format = (match: string, index: number) => {
    return (
      <React.Fragment key={ `email-${index}` }>
        <a href={ `mailto:${match}` } className='underline' target='_blank' rel='noreferrer noopener'>{match}</a>
      </React.Fragment>
    );
  };
  return regexApplicator(text, findEmailInTextRegex, format);
};

const newlineRegexResult = (text: FormatterInput) => {
  const newlineRegex = /\n/gim;
  const format = (_match: string, index: number) => <br key={ `nl-${index}` }/>;
  return regexApplicator(text, newlineRegex, format);
};

const phoneRegexResult = (text: FormatterInput) => {
  const phoneRegex = getPhoneRegex();
  const format = (match: string, index: number) => {
    const phone = validatePhoneNumber(match);
    return phone ? (
      <React.Fragment key={ `phone-${index}` }>
        <PhoneLink phone={ phone } />
      </React.Fragment>
    ) : match;
  };
  // matchGroup 1: the phone regex consumes a leading boundary char outside group 1.
  return regexApplicator(text, phoneRegex, format, 1);
};

// Order is load-bearing: reduceRight applies these from last to first, so newline runs
// first and phone runs last. Phone must run last so it doesn't match digits inside
// already-formatted URLs/emails. Reordering this array changes that nesting.
const messageFormatters = [phoneRegexResult, urlRegexResult, emailRegexResult, newlineRegexResult] as const;

export const formatMessageText = (text: string): (string | ReactElement)[] =>
  messageFormatters.reduceRight<(string | ReactElement)[]>(
    (formatted, formatter) => formatter(formatted),
    [text],
  );
