import * as schema from "@x-like-digest/shared";
import { drizzle } from "drizzle-orm/d1";

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
