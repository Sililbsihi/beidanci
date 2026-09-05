import { pgTable, serial, varchar, text, timestamp, integer, index } from "drizzle-orm/pg-core"

/**
 * words 单词表：识别入库的单词 + 背诵进度
 * - correct_round: 当前轮已正确照抄次数（0-3，达到 3 记 1 遍背诵并清零）
 * - recite_count:  累计已背诵遍数（每完成一轮 3 次正确照抄 +1，可累加）
 * - total_typed:   累计正确照抄次数（= recite_count * 3 + correct_round）
 */
export const words = pgTable(
  "words",
  {
    id: serial("id").primaryKey(),
    word: varchar("word", { length: 100 }).notNull(),
    pos: varchar("pos", { length: 20 }),
    translation: text("translation"),
    translation_source: varchar("translation_source", { length: 20 }).default("upload").notNull(),
    source_file: varchar("source_file", { length: 255 }),
    batch_id: varchar("batch_id", { length: 36 }),
    correct_round: integer("correct_round").default(0).notNull(),
    recite_count: integer("recite_count").default(0).notNull(),
    total_typed: integer("total_typed").default(0).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    recited_at: timestamp("recited_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("words_word_idx").on(table.word),
    index("words_status_idx").on(table.status),
    index("words_batch_id_idx").on(table.batch_id),
    index("words_recited_at_idx").on(table.recited_at),
  ],
)

/**
 * upload_files 上传临时文件表：记录上传到对象存储的临时文件，
 * 识别用 + 当前批次背诵完成后通过 cleanup 删除（status 置为 deleted）。
 */
export const uploadFiles = pgTable(
  "upload_files",
  {
    id: serial("id").primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull(),
    file_key: varchar("file_key", { length: 512 }).notNull(),
    file_type: varchar("file_type", { length: 20 }).notNull(),
    batch_id: varchar("batch_id", { length: 36 }).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("upload_files_batch_id_idx").on(table.batch_id),
    index("upload_files_status_idx").on(table.status),
  ],
)

/**
 * practice_records 背诵流水表：每次正确照抄写入一条，
 * round_index = 3 的记录代表完成一轮背诵（用于历史记录与连续天数统计）。
 */
export const practiceRecords = pgTable(
  "practice_records",
  {
    id: serial("id").primaryKey(),
    word_id: integer("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    word: varchar("word", { length: 100 }).notNull(),
    round_index: integer("round_index").notNull(),
    session_no: integer("session_no").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("practice_records_word_id_idx").on(table.word_id),
    index("practice_records_created_at_idx").on(table.created_at),
  ],
)
