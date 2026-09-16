import { pgTable, serial, timestamp, varchar, text, integer, boolean, index, foreignKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const uploadFiles = pgTable("upload_files", {
	id: serial().primaryKey().notNull(),
	filename: varchar({ length: 255 }).notNull(),
	fileKey: varchar("file_key", { length: 512 }).notNull(),
	fileType: varchar("file_type", { length: 20 }).notNull(),
	batchId: varchar("batch_id", { length: 36 }).notNull(),
	status: varchar({ length: 20 }).default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
});

export const words = pgTable("words", {
	id: serial().primaryKey().notNull(),
	word: varchar({ length: 100 }).notNull(),
	pos: varchar({ length: 20 }),
	translation: text(),
	translationSource: varchar("translation_source", { length: 20 }).default('upload').notNull(),
	sourceFile: varchar("source_file", { length: 255 }),
	batchId: varchar("batch_id", { length: 36 }),
	correctRound: integer("correct_round").default(0).notNull(),
	reciteCount: integer("recite_count").default(0).notNull(),
	totalTyped: integer("total_typed").default(0).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	targetRecite: integer("target_recite").default(1).notNull(),
	importCount: integer("import_count").default(1).notNull(),
	starred: boolean("starred").default(false).notNull(),
	recitedAt: timestamp("recited_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const practiceRecords = pgTable("practice_records", {
	id: serial().primaryKey().notNull(),
	wordId: integer("word_id").notNull(),
	word: varchar({ length: 100 }).notNull(),
	roundIndex: integer("round_index").notNull(),
	sessionNo: integer("session_no").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("practice_records_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("practice_records_word_id_idx").using("btree", table.wordId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.wordId],
			foreignColumns: [words.id],
			name: "practice_records_word_id_fkey"
		}).onDelete("cascade"),
]);
