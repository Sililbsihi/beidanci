import { relations } from "drizzle-orm/relations";
import { words, practiceRecords } from "./schema";

export const practiceRecordsRelations = relations(practiceRecords, ({one}) => ({
	word: one(words, {
		fields: [practiceRecords.wordId],
		references: [words.id]
	}),
}));

export const wordsRelations = relations(words, ({many}) => ({
	practiceRecords: many(practiceRecords),
}));