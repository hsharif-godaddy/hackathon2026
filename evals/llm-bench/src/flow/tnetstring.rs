//! Decoder for mitmproxy's tnetstring dialect.
//!
//! mitmproxy serializes flow files as a sequence of concatenated top-level
//! tnetstrings (one dict per HTTP flow). The wire format is
//! `<len>:<payload><typechar>` where `<len>` is the ASCII byte length of
//! `<payload>` and `<typechar>` is one byte selecting the type:
//!
//! | char | type                                   |
//! |------|----------------------------------------|
//! | `;`  | unicode string                         |
//! | `,`  | byte string                            |
//! | `#`  | integer                                |
//! | `^`  | float                                  |
//! | `~`  | null (zero-length payload)             |
//! | `!`  | boolean (`true` / `false`)             |
//! | `]`  | list (payload = concatenated values)   |
//! | `}`  | dict (payload = concatenated k/v pairs)|
//!
//! The decoder is cursor-based so it can walk the concatenated top-level
//! stream: [`parse_one`] advances the slice and returns `Ok(None)` at clean
//! EOF.

use std::fmt;

/// A decoded tnetstring value.
///
/// mitmproxy distinguishes unicode strings (`;`) from byte strings (`,`); we
/// preserve that distinction because keys arrive as strings while payloads such
/// as request/response bodies arrive as bytes.
#[derive(Debug, Clone, PartialEq)]
pub enum TnetValue {
    Str(String),
    Bytes(Vec<u8>),
    Int(i64),
    Float(f64),
    Bool(bool),
    Null,
    List(Vec<TnetValue>),
    Dict(Vec<(String, TnetValue)>),
}

/// Error raised when a byte stream is not a well-formed tnetstring.
#[derive(Debug, thiserror::Error)]
pub enum TnetError {
    #[error("unexpected end of input while reading {0}")]
    UnexpectedEof(&'static str),
    #[error("missing ':' length delimiter")]
    MissingColon,
    #[error("invalid length prefix: {0}")]
    InvalidLength(String),
    #[error("declared length {declared} exceeds {available} remaining bytes")]
    LengthOverflow { declared: usize, available: usize },
    #[error("unknown type char {0:?}")]
    UnknownType(char),
    #[error("invalid integer payload: {0}")]
    InvalidInt(String),
    #[error("invalid float payload: {0}")]
    InvalidFloat(String),
    #[error("invalid bool payload: {0}")]
    InvalidBool(String),
    #[error("invalid utf-8 in {0}")]
    InvalidUtf8(&'static str),
    #[error("dict key was not a string (type {0:?})")]
    NonStringKey(char),
}

impl TnetValue {
    /// Returns the dict entries, if this value is a dict.
    pub fn as_dict(&self) -> Option<&[(String, TnetValue)]> {
        match self {
            TnetValue::Dict(entries) => Some(entries),
            _ => None,
        }
    }

    /// Returns the list entries, if this value is a list.
    pub fn as_list(&self) -> Option<&[TnetValue]> {
        match self {
            TnetValue::List(items) => Some(items),
            _ => None,
        }
    }

    /// Looks up a key in a dict value.
    pub fn get(&self, key: &str) -> Option<&TnetValue> {
        self.as_dict()?
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
    }

    /// Returns the value as a string slice, accepting both `;` strings and
    /// UTF-8 `,` byte strings (mitmproxy is inconsistent about which it uses
    /// for short ASCII fields like the HTTP method).
    pub fn as_str(&self) -> Option<&str> {
        match self {
            TnetValue::Str(s) => Some(s),
            TnetValue::Bytes(b) => std::str::from_utf8(b).ok(),
            _ => None,
        }
    }

    /// Returns the raw bytes for a `,` byte string (or the UTF-8 bytes of a
    /// `;` string), used for request/response bodies.
    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            TnetValue::Bytes(b) => Some(b),
            TnetValue::Str(s) => Some(s.as_bytes()),
            _ => None,
        }
    }

    /// Returns the value as an `i64`.
    pub fn as_int(&self) -> Option<i64> {
        match self {
            TnetValue::Int(i) => Some(*i),
            _ => None,
        }
    }

    /// Returns the value as an `f64`, accepting integers too (timestamps are
    /// floats but a whole-second capture may serialize as an int).
    pub fn as_float(&self) -> Option<f64> {
        match self {
            TnetValue::Float(f) => Some(*f),
            TnetValue::Int(i) => Some(*i as f64),
            _ => None,
        }
    }
}

impl fmt::Display for TnetValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TnetValue::Str(s) => write!(f, "{s}"),
            TnetValue::Bytes(b) => write!(f, "<{} bytes>", b.len()),
            TnetValue::Int(i) => write!(f, "{i}"),
            TnetValue::Float(v) => write!(f, "{v}"),
            TnetValue::Bool(b) => write!(f, "{b}"),
            TnetValue::Null => write!(f, "null"),
            TnetValue::List(items) => write!(f, "<list of {}>", items.len()),
            TnetValue::Dict(entries) => write!(f, "<dict of {}>", entries.len()),
        }
    }
}

/// Parses one tnetstring from the front of `cursor`, advancing it past the
/// consumed bytes. Returns `Ok(None)` only when `cursor` is empty (clean EOF).
pub fn parse_one(cursor: &mut &[u8]) -> Result<Option<TnetValue>, TnetError> {
    if cursor.is_empty() {
        return Ok(None);
    }
    let (payload, type_char, rest) = split_frame(cursor)?;
    *cursor = rest;
    Ok(Some(decode_payload(payload, type_char)?))
}

/// Parses every top-level tnetstring in `data` until the bytes are exhausted.
pub fn parse_stream(data: &[u8]) -> Result<Vec<TnetValue>, TnetError> {
    let mut cursor: &[u8] = data;
    let mut out: Vec<TnetValue> = Vec::new();
    while let Some(value) = parse_one(&mut cursor)? {
        out.push(value);
    }
    Ok(out)
}

/// Splits one `<len>:<payload><typechar>` frame off the front of `data`,
/// returning `(payload, type_char, rest_after_type_char)`.
fn split_frame(data: &[u8]) -> Result<(&[u8], u8, &[u8]), TnetError> {
    let colon = data
        .iter()
        .position(|&b| b == b':')
        .ok_or(TnetError::MissingColon)?;
    let len_str =
        std::str::from_utf8(&data[..colon]).map_err(|_| TnetError::InvalidUtf8("length prefix"))?;
    let len: usize = len_str
        .parse()
        .map_err(|_| TnetError::InvalidLength(len_str.to_string()))?;

    let payload_start = colon + 1;
    let payload_end = payload_start
        .checked_add(len)
        .ok_or(TnetError::InvalidLength(len_str.to_string()))?;
    if payload_end >= data.len() {
        return Err(TnetError::LengthOverflow {
            declared: len,
            available: data.len().saturating_sub(payload_start),
        });
    }
    let payload = &data[payload_start..payload_end];
    let type_char = data[payload_end];
    let rest = &data[payload_end + 1..];
    Ok((payload, type_char, rest))
}

/// Decodes a frame payload according to its type char, recursing into the
/// concatenated children of lists and dicts.
fn decode_payload(payload: &[u8], type_char: u8) -> Result<TnetValue, TnetError> {
    match type_char {
        b';' => Ok(TnetValue::Str(
            std::str::from_utf8(payload)
                .map_err(|_| TnetError::InvalidUtf8("string"))?
                .to_string(),
        )),
        b',' => Ok(TnetValue::Bytes(payload.to_vec())),
        b'#' => {
            let s = std::str::from_utf8(payload).map_err(|_| TnetError::InvalidUtf8("integer"))?;
            Ok(TnetValue::Int(
                s.parse()
                    .map_err(|_| TnetError::InvalidInt(s.to_string()))?,
            ))
        }
        b'^' => {
            let s = std::str::from_utf8(payload).map_err(|_| TnetError::InvalidUtf8("float"))?;
            Ok(TnetValue::Float(
                s.parse()
                    .map_err(|_| TnetError::InvalidFloat(s.to_string()))?,
            ))
        }
        b'!' => match payload {
            b"true" => Ok(TnetValue::Bool(true)),
            b"false" => Ok(TnetValue::Bool(false)),
            other => Err(TnetError::InvalidBool(
                String::from_utf8_lossy(other).into_owned(),
            )),
        },
        b'~' => Ok(TnetValue::Null),
        b']' => Ok(TnetValue::List(decode_list(payload)?)),
        b'}' => Ok(TnetValue::Dict(decode_dict(payload)?)),
        other => Err(TnetError::UnknownType(other as char)),
    }
}

/// Decodes the concatenated children of a list payload.
fn decode_list(payload: &[u8]) -> Result<Vec<TnetValue>, TnetError> {
    let mut cursor: &[u8] = payload;
    let mut items: Vec<TnetValue> = Vec::new();
    while let Some(value) = parse_one(&mut cursor)? {
        items.push(value);
    }
    Ok(items)
}

/// Decodes the concatenated key/value pairs of a dict payload. Keys must be
/// strings (mitmproxy encodes them with `;`, but we also accept UTF-8 byte
/// strings defensively).
fn decode_dict(payload: &[u8]) -> Result<Vec<(String, TnetValue)>, TnetError> {
    let mut cursor: &[u8] = payload;
    let mut entries: Vec<(String, TnetValue)> = Vec::new();
    while let Some(key) = parse_one(&mut cursor)? {
        let key = match key {
            TnetValue::Str(s) => s,
            TnetValue::Bytes(b) => {
                String::from_utf8(b).map_err(|_| TnetError::InvalidUtf8("dict key"))?
            }
            other => {
                return Err(TnetError::NonStringKey(type_char_of(&other)));
            }
        };
        let value = parse_one(&mut cursor)?.ok_or(TnetError::UnexpectedEof("dict value"))?;
        entries.push((key, value));
    }
    Ok(entries)
}

/// Returns the wire type char a value would serialize as (for error messages).
fn type_char_of(value: &TnetValue) -> char {
    match value {
        TnetValue::Str(_) => ';',
        TnetValue::Bytes(_) => ',',
        TnetValue::Int(_) => '#',
        TnetValue::Float(_) => '^',
        TnetValue::Bool(_) => '!',
        TnetValue::Null => '~',
        TnetValue::List(_) => ']',
        TnetValue::Dict(_) => '}',
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_each_scalar_type() {
        assert_eq!(
            parse_stream(b"5:hello;").unwrap()[0],
            TnetValue::Str("hello".into())
        );
        assert_eq!(
            parse_stream(b"2:OK,").unwrap()[0],
            TnetValue::Bytes(b"OK".to_vec())
        );
        assert_eq!(parse_stream(b"3:200#").unwrap()[0], TnetValue::Int(200));
        assert_eq!(
            parse_stream(b"15:1782241036.4998^").unwrap()[0],
            TnetValue::Float(1782241036.4998)
        );
        assert_eq!(parse_stream(b"4:true!").unwrap()[0], TnetValue::Bool(true));
        assert_eq!(
            parse_stream(b"5:false!").unwrap()[0],
            TnetValue::Bool(false)
        );
    }

    #[test]
    fn decodes_empty_payloads() {
        assert_eq!(parse_stream(b"0:~").unwrap()[0], TnetValue::Null);
        assert_eq!(
            parse_stream(b"0:,").unwrap()[0],
            TnetValue::Bytes(Vec::new())
        );
        assert_eq!(
            parse_stream(b"0:;").unwrap()[0],
            TnetValue::Str(String::new())
        );
    }

    #[test]
    fn decodes_nested_dict() {
        // {"status_code": 200, "reason": b"OK"}
        let frame = b"35:11:status_code;3:200#6:reason;2:OK,}";
        let value = &parse_stream(frame).unwrap()[0];
        assert_eq!(
            value.get("status_code").and_then(TnetValue::as_int),
            Some(200)
        );
        assert_eq!(value.get("reason").and_then(TnetValue::as_str), Some("OK"));
    }

    #[test]
    fn decodes_list_of_lists_headers() {
        // [[b"content-type", b"application/json"]]
        let inner = b"12:content-type,16:application/json,";
        let inner_list = format!("{}:{}]", inner.len(), String::from_utf8_lossy(inner));
        let outer = format!("{}:{}]", inner_list.len(), inner_list);
        let value = &parse_stream(outer.as_bytes()).unwrap()[0];
        let headers = value.as_list().unwrap();
        assert_eq!(headers.len(), 1);
        let pair = headers[0].as_list().unwrap();
        assert_eq!(pair[0].as_str(), Some("content-type"));
        assert_eq!(pair[1].as_str(), Some("application/json"));
    }

    #[test]
    fn walks_concatenated_top_level_stream() {
        let values = parse_stream(b"3:200#2:OK,0:~").unwrap();
        assert_eq!(values.len(), 3);
        assert_eq!(values[0], TnetValue::Int(200));
        assert_eq!(values[1], TnetValue::Bytes(b"OK".to_vec()));
        assert_eq!(values[2], TnetValue::Null);
    }

    #[test]
    fn handles_large_body() {
        let body = vec![b'x'; 200_000];
        let frame = format!("{}:", body.len()).into_bytes();
        let mut wire = frame;
        wire.extend_from_slice(&body);
        wire.push(b',');
        let value = &parse_stream(&wire).unwrap()[0];
        assert_eq!(value.as_bytes().map(<[u8]>::len), Some(200_000));
    }

    #[test]
    fn payload_bytes_may_contain_delimiters() {
        // A byte payload that itself contains ':' and ';' must not confuse the
        // length-prefixed parser.
        let value = &parse_stream(b"5:a:b;c,").unwrap()[0];
        assert_eq!(value, &TnetValue::Bytes(b"a:b;c".to_vec()));
    }

    #[test]
    fn rejects_length_overflow() {
        assert!(matches!(
            parse_stream(b"99:short,"),
            Err(TnetError::LengthOverflow { .. })
        ));
    }
}
