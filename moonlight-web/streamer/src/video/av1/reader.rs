use std::io::{self, Read};

use bytes::{BufMut, BytesMut};

#[derive(Debug)]
pub struct Obu {
    pub full: BytesMut,
    pub payload_range: std::ops::Range<usize>,
}

pub struct Av1Reader<R: Read> {
    reader: R,
    buffer: BytesMut,
}

impl<R: Read> Av1Reader<R> {
    pub fn new(reader: R, capacity: usize) -> Self {
        Self {
            reader,
            buffer: BytesMut::with_capacity(capacity),
        }
    }

    pub fn next_obu(&mut self) -> Result<Option<Obu>, io::Error> {
        self.buffer.clear();

        // Read OBU Header Byte
        let mut header_byte = [0u8; 1];
        if self.reader.read(&mut header_byte)? == 0 {
            return Ok(None);
        }
        self.buffer.put_u8(header_byte[0]);

        // Parse Header
        let obu_forbidden_bit = (header_byte[0] & 0x80) != 0;
        if obu_forbidden_bit {
            // Forbidden bit must be 0
            // If we encounter this, it's likely sync loss or garbage
            return Err(io::Error::new(io::ErrorKind::InvalidData, "AV1 OBU forbidden bit set"));
        }

        let obu_extension_flag = (header_byte[0] & 0x04) != 0;
        let obu_has_size_field = (header_byte[0] & 0x02) != 0;

        if obu_extension_flag {
            if self.reader.read(&mut header_byte)? == 0 {
                 return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "EOF reading extension header"));
            }
            self.buffer.put_u8(header_byte[0]);
        }

        let mut obu_size = 0;
        if obu_has_size_field {
            // Read LEB128
            let mut shift = 0;
            loop {
                if self.reader.read(&mut header_byte)? == 0 {
                     return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "EOF reading OBU size"));
                }
                let byte = header_byte[0];
                self.buffer.put_u8(byte);

                obu_size |= ((byte & 0x7F) as usize) << shift;
                shift += 7;
                if (byte & 0x80) == 0 {
                    break;
                }
                if shift >= 64 {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, "OBU size too large (shift overflow)"));
                }
            }

            // 32 MB sanity check
            if obu_size > 32 * 1024 * 1024 {
                return Err(io::Error::new(io::ErrorKind::InvalidData, format!("OBU size too large: {}", obu_size)));
            }
        } else {
            // If size field is missing, the OBU extends to the end of the stream.
            // Since we are reading from a Cursor of a generic Vec, likely containing one frame,
            // we read to end.
            let mut remainder = Vec::new();
            self.reader.read_to_end(&mut remainder)?;
            obu_size = remainder.len();
            self.buffer.extend_from_slice(&remainder);
            
            // We already put the data in buffer, no need to read strictly `obu_size` bytes effectively
            // BUT for the code path below, we handled it.
            // Let's adjust logic.
        }

        if obu_has_size_field {
             // Read payload
             // We need to read `obu_size` bytes
             // Note: using local buffer or resizing BytesMut?
             // BytesMut extend works great.
             
             // We can use take() but we want to put into self.buffer
             let mut chunk = (&mut self.reader).take(obu_size as u64);
             // We need to write to buffer. there is no easy "read_all_to_buf" without intermediate or loop
             // But size is known.
             if self.buffer.capacity() < self.buffer.len() + obu_size {
                 self.buffer.reserve(obu_size);
             }
             
             // Unsafe advance or temporary buffer?
             // Safest is temporary buffer or loop.
             // Given it's a cursor over memory usually, maybe fast enough.
             let current_len = self.buffer.len();
             self.buffer.resize(current_len + obu_size, 0);
             chunk.read_exact(&mut self.buffer[current_len..])?;
        }

        let full = self.buffer.split(); // Returns the filled buffer, leaves empty
        let len = full.len();

        Ok(Some(Obu {
            full,
            payload_range: 0..len, // The reader already extracted exactly one OBU
        }))
    }

    pub fn reset(&mut self, new_reader: R) {
        self.reader = new_reader;
    }
}
