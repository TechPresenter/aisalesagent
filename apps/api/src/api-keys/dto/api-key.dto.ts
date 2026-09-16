import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { API_KEY_SCOPES } from "../api-key.util";

/** Expiry is a choice from a short list: a key with an arbitrary lifetime is harder to audit. */
export const API_KEY_EXPIRY_DAYS = [30, 90, 180, 365];

export class CreateApiKeyDto {
  /** What the key is for — "Website form", "Data warehouse" — so revoking the right one is easy. */
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: string[];

  /** Omitted for a key that does not expire. */
  @IsOptional()
  @IsInt()
  @IsIn(API_KEY_EXPIRY_DAYS)
  expiresInDays?: number;
}
