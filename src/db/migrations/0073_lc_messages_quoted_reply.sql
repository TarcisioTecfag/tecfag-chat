ALTER TABLE lc_messages ADD COLUMN IF NOT EXISTS quoted_message_id TEXT;
ALTER TABLE lc_messages ADD COLUMN IF NOT EXISTS quoted_message_sender TEXT;
ALTER TABLE lc_messages ADD COLUMN IF NOT EXISTS quoted_message_content TEXT;
