import { z } from "zod";

const nonEmptyList = z.array(z.string().trim().min(1)).min(1);

export const authSchema = z.object({
  email: z.string().email().max(180).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const siteSpecSchema = z.object({
  siteName: z.string().trim().min(2).max(100),
  mediaTopics: nonEmptyList,
  targetAudience: nonEmptyList,
  languages: nonEmptyList,
  categories: nonEmptyList,
  contentTypes: nonEmptyList,
  homepageFocus: nonEmptyList,
  design: z.object({
    style: z.string().min(1),
    referenceWebsite: z.string().url().or(z.literal("")),
    contentDensity: z.string().min(1),
    colorScheme: z.string().min(1),
    primaryColor: z.string().max(30),
    secondaryColor: z.string().max(30),
    backgroundColor: z.string().max(30),
    logo: z.object({ mode: z.enum(["provided", "generate", "text-only"]) }),
    visualIdentity: z.string(),
    fontPreference: z.string(),
  }),
  features: nonEmptyList,
  additionalNotes: z.string().max(4000),
});

export const continuationSchema = z.object({
  instruction: z.string().trim().min(3).max(4000),
});
