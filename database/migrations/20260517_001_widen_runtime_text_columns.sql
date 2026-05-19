-- Repeatable migration: widen runtime path, URL, JSON, transcript, and error fields.
-- Safe to run multiple times. MySQL 8.0 compatible.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  applied_at VARCHAR(64) NOT NULL,
  checksum VARCHAR(128) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS widen_column_if_needed;

DELIMITER $$
CREATE PROCEDURE widen_column_if_needed(
  IN p_table VARCHAR(128),
  IN p_column VARCHAR(128),
  IN p_definition TEXT
)
BEGIN
  DECLARE v_data_type VARCHAR(64);
  DECLARE v_is_nullable VARCHAR(8);
  DECLARE v_target_nullable VARCHAR(8);
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_data_type = NULL;

  SELECT DATA_TYPE, IS_NULLABLE
    INTO v_data_type, v_is_nullable
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = p_table
     AND COLUMN_NAME = p_column
   LIMIT 1;

  SET v_target_nullable = IF(UPPER(p_definition) LIKE '% NOT NULL%', 'NO', 'YES');

  IF v_data_type IS NOT NULL
     AND (LOWER(v_data_type) <> 'longtext' OR v_is_nullable <> v_target_nullable) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` MODIFY COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL widen_column_if_needed('digital_human_templates', 'output_relative_path', 'LONGTEXT NOT NULL');
CALL widen_column_if_needed('digital_human_templates', 'selfie_relative_path', 'LONGTEXT NOT NULL');

CALL widen_column_if_needed('user_works', 'content', 'LONGTEXT NULL');
CALL widen_column_if_needed('user_works', 'transcript_text', 'LONGTEXT NULL');
CALL widen_column_if_needed('user_works', 'rewrite_text', 'LONGTEXT NULL');
CALL widen_column_if_needed('user_works', 'source_video_url', 'LONGTEXT NOT NULL');
CALL widen_column_if_needed('user_works', 'output_video_url', 'LONGTEXT NULL');
CALL widen_column_if_needed('user_works', 'task_payload_json', 'LONGTEXT NOT NULL');

CALL widen_column_if_needed('task_statuses', 'payload_json', 'LONGTEXT NULL');
CALL widen_column_if_needed('task_statuses', 'result_json', 'LONGTEXT NULL');
CALL widen_column_if_needed('task_statuses', 'error', 'LONGTEXT NULL');

CALL widen_column_if_needed('avatar_resources', 'cover_url', 'LONGTEXT NULL');
CALL widen_column_if_needed('avatar_resources', 'source_video_url', 'LONGTEXT NULL');

CALL widen_column_if_needed('voice_resources', 'audio_url', 'LONGTEXT NULL');
CALL widen_column_if_needed('voice_resources', 'clone_error', 'LONGTEXT NULL');

CALL widen_column_if_needed('subtitle_template_resources', 'cover_url', 'LONGTEXT NULL');
CALL widen_column_if_needed('subtitle_template_resources', 'preview_url', 'LONGTEXT NULL');
CALL widen_column_if_needed('subtitle_template_resources', 'style_json', 'LONGTEXT NOT NULL');

CALL widen_column_if_needed('audit_logs', 'detail', 'LONGTEXT NULL');

DROP PROCEDURE IF EXISTS widen_column_if_needed;

INSERT INTO schema_migrations (id, applied_at, checksum)
VALUES (
  '20260517_001_widen_runtime_text_columns',
  DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ'),
  'repeatable'
)
ON DUPLICATE KEY UPDATE
  applied_at = VALUES(applied_at),
  checksum = VALUES(checksum);
