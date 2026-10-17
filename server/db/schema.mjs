import { pgTable, uuid, text, timestamp, doublePrecision, boolean, jsonb, bigint, index, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const interviews = pgTable('interviews', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  project: text('project').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  duration: doublePrecision('duration').notNull(),
  model: text('model').notNull(),
  language: text('language').notNull(),
  starred: boolean('starred').notNull().default(false),
  notes: text('notes').notNull().default(''),
  transcript: text('transcript').notNull(),
  segments: jsonb('segments').notNull(),
  audioFile: text('audio_file').notNull(),
  audioType: text('audio_type').notNull(),
  audioSize: bigint('audio_size', { mode: 'number' }).notNull(),
}, (table) => [
  index('interviews_created_at_idx').on(table.createdAt),
  check('interviews_duration_check', sql`${table.duration} >= 0`),
  check('interviews_audio_size_check', sql`${table.audioSize} > 0`),
])
