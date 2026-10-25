import type { Diagnostic, Sentence, Span, Token, WritingIntent } from "./domain";

export interface GoalCueContext {
    text: string;
    sentences: readonly Sentence[];
    writingIntent: WritingIntent;
}

export interface WritingGoalCueRule {
    id: string;
    goalId: string;
    fixture: string;
    prompt: string;
    priority: number;
    detect(context: GoalCueContext): Span | undefined;
}

type Cue = (context: GoalCueContext) => Span | undefined;

function insideCode(text: string, start: number, end: number): boolean {
    const fenced = /```[\s\S]*?(?:```|$)/gu;
    for (const match of text.matchAll(fenced)) {
        const codeStart = match.index!;
        if (start < codeStart + match[0].length && end > codeStart) return true;
    }
    return [...text.matchAll(/`[^`\n]+`/gu)].some((match) => {
        const codeStart = match.index!;
        return start < codeStart + match[0].length && end > codeStart;
    });
}

function textCue(pattern: RegExp): Cue {
    const matcher = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    return ({ text }) => {
        matcher.lastIndex = 0;
        for (const match of text.matchAll(matcher)) {
            if (!match[0]) continue;
            const start = match.index!;
            const end = start + match[0].length;
            if (!insideCode(text, start, end)) return { start, end };
        }
        return undefined;
    };
}

function tokenCue(predicate: (token: Token, sentence: Sentence) => boolean): Cue {
    return ({ sentences, text }) => {
        for (const sentence of sentences) {
            const token = sentence.tokens.find(
                (item) => !insideCode(text, item.start, item.end) && predicate(item, sentence),
            );
            if (token) return { start: token.start, end: token.end };
        }
        return undefined;
    };
}

function relationCue(predicate: (sentence: Sentence) => boolean): Cue {
    return ({ sentences, text }) => {
        for (const sentence of sentences) {
            if (!predicate(sentence)) continue;
            const token = sentence.tokens.find(
                (item) => item.pos !== "PUNCT" && !insideCode(text, item.start, item.end),
            );
            if (token) return { start: token.start, end: token.end };
        }
        return undefined;
    };
}

function rule(
    slug: string,
    fixture: string,
    prompt: string,
    detect: Cue,
    priority = 20,
): WritingGoalCueRule {
    return {
        id: `writing-cue-${slug}`,
        goalId: `writing.${slug}`,
        fixture,
        prompt,
        priority,
        detect,
    };
}

const hasPos = (...pos: Token["pos"][]) => tokenCue((item) => pos.includes(item.pos));
const contains = (pattern: RegExp) => textCue(pattern);
const prenominalModifier = tokenCue((item, sentence) => {
    const index = sentence.tokens.indexOf(item);
    return (
        sentence.tokens[index - 1]?.pos === "DET" &&
        ["NOUN", "PROPN"].includes(sentence.tokens[index + 1]?.pos ?? "")
    );
});
const adverbCue = (context: GoalCueContext) =>
    hasPos("ADV")(context) ?? textCue(/\b\p{L}{3,}ly\b/iu)(context);
const hasCoordination = relationCue((sentence) =>
    sentence.graph.some((edge) => edge.relation === "conj"),
);
const coordinationCue: Cue = (context) =>
    hasCoordination(context) ?? textCue(/\b(?:and|but|or|nor)\b/iu)(context);
const hasSubordinateClause = relationCue((sentence) =>
    sentence.graph.some((edge) => ["advcl", "ccomp", "acl:relcl"].includes(edge.relation)),
);
const subordinateCue: Cue = (context) =>
    hasSubordinateClause(context) ??
    textCue(/\b(?:when|because|although|if|while|since|unless)\b/iu)(context);
const hasPassive = relationCue((sentence) =>
    sentence.graph.some((edge) => edge.relation === "nsubj:pass" || edge.relation === "aux:pass"),
);
const passiveCue: Cue = (context) =>
    hasPassive(context) ??
    textCue(/\b(?:am|is|are|was|were|be|been|being)\s+\p{L}{3,}(?:ed|en)\b/iu)(context);
const hasNounPhrase = hasPos("NOUN", "PROPN");
const wordCount = (text: string) => text.match(/\p{L}+/gu)?.length ?? 0;
const forShortWriting =
    (cue: Cue, maximumWords: number): Cue =>
    (context) =>
        wordCount(context.text) <= maximumWords ? cue(context) : undefined;
const capitalizedInteriorCue: Cue = ({ text, sentences }) => {
    for (const sentence of sentences) {
        const firstWord = sentence.tokens.find((item) => /\p{L}/u.test(item.text));
        const candidate = sentence.tokens.find(
            (item) =>
                item !== firstWord &&
                item.start > sentence.start &&
                /^\p{Lu}[\p{Ll}'’-]{1,24}$/u.test(item.text) &&
                !insideCode(text, item.start, item.end),
        );
        if (candidate) return { start: candidate.start, end: candidate.end };
    }
    return undefined;
};

/**
 * These are surface-evidence cues, not classifiers for whether a writer has mastered a skill.
 * They only run when optional style observations are enabled and never propose text edits.
 */
export const writingGoalCueRules: readonly WritingGoalCueRule[] = [
    rule(
        "marks",
        "m",
        "A short written mark is present. Emergent drawings and meaning-making are outside this text-only check.",
        ({ text }) => {
            const start = text.search(/\S/u);
            return start >= 0 && text.trim().length <= 3
                ? { start, end: start + text.trim().length }
                : undefined;
        },
        1,
    ),
    rule(
        "labels",
        "Tree: a tall plant.",
        "A label-like name-and-description pattern appears. Check whether the label is useful alongside any visual context.",
        contains(/^\s*[\p{L}\p{N}][^\n:]{0,30}:\s+\S/mu),
        2,
    ),
    rule(
        "name",
        "Mia visited Toronto.",
        "A capitalized name-like token appears. This check does not verify the identity or intended spelling of a name.",
        (context) =>
            tokenCue((item, sentence) => item.pos === "PROPN" && item.start > sentence.start)(
                context,
            ) ?? capitalizedInteriorCue(context),
        3,
    ),
    rule(
        "message",
        "Birds fly.",
        "A short written message is present. This only recognizes text; it does not assess how clearly the message communicates.",
        forShortWriting(({ sentences, text }) => {
            for (const sentence of sentences) {
                const words = sentence.tokens.filter(
                    (part) => part.pos !== "PUNCT" && !insideCode(text, part.start, part.end),
                );
                if (words.length >= 2) return { start: words[0]!.start, end: words[0]!.end };
            }
            return undefined;
        }, 12),
        4,
    ),
    rule(
        "sequence",
        "First, we packed the boxes, checked the map, and locked every door before the bus arrived. Then we left.",
        "An ordering word appears. Check whether the order reflects the intended sequence of events or steps.",
        contains(/\b(?:first|next|then|afterward|finally|before|after)\b/iu),
        8,
    ),
    rule(
        "detail",
        "The small blue kite drifted slowly.",
        "A descriptive modifier appears. Consider whether the detail helps this reader picture or understand the subject.",
        forShortWriting(
            (context) =>
                hasPos("ADJ", "ADV", "NUM")(context) ??
                prenominalModifier(context) ??
                adverbCue(context),
            40,
        ),
        10,
    ),
    rule(
        "nouns",
        "The bright lantern glowed.",
        "A noun phrase is present. This cue does not assess whether the chosen nouns are specific enough for the intended meaning.",
        forShortWriting(hasNounPhrase, 25),
        16,
    ),
    rule(
        "verbs",
        "The lantern glowed.",
        "A verb is present. This cue does not evaluate whether it expresses the intended action or state precisely.",
        forShortWriting(hasPos("VERB", "AUX"), 25),
        16,
    ),
    rule(
        "past",
        "They walked home yesterday.",
        "A past-time verb form appears. Check that its time relationship matches the surrounding events.",
        ({ text, sentences, writingIntent }) =>
            tokenCue((item) =>
                item.analyses.some(
                    (analysis) =>
                        analysis.tense === "Past" || analysis.udFeatures?.Tense === "Past",
                ),
            )({ text, sentences, writingIntent }) ??
            textCue(/\b\p{L}{3,}ed\b/iu)({ text, sentences, writingIntent }),
        18,
    ),
    rule(
        "paragraph",
        "The room was cold. We lit a fire.\n\nThe windows cleared.",
        "More than one paragraph is present. Check whether the paragraph break signals a useful shift for the reader.",
        contains(/\S[^\n]*\n\s*\n\s*\S/u),
        20,
    ),
    rule(
        "topic",
        "## Restoring the wetland\nThe marsh filters water and shelters birds.",
        "A heading or opening sentence may establish a topic. Check that readers can identify the main idea of this section.",
        contains(/^\s*#{1,6}\s+\S|^\s*[^\n]{12,90}\n/u),
        24,
    ),
    rule(
        "support",
        "The path floods after heavy rain because the drains are blocked.",
        "A reason or example marker appears. Check whether the support directly explains the point it follows.",
        contains(
            /\b(?:because|for example|for instance|according to|the data show|the report finds)\b/iu,
        ),
        22,
    ),
    rule(
        "transitions",
        "The route is shorter. However, it has no sidewalk.",
        "A transition or contrast marker appears. Check that the relationship between the surrounding ideas is clear.",
        contains(
            /\b(?:however|therefore|meanwhile|for example|in contrast|as a result|next|finally|also)\b/iu,
        ),
        21,
    ),
    rule(
        "adjectives",
        "A quiet stream crossed the field.",
        "A word in a pre-noun modifier position appears. Consider whether it contributes useful information in this context; this is a structural cue, not a part-of-speech judgment.",
        forShortWriting((context) => hasPos("ADJ")(context) ?? prenominalModifier(context), 40),
        30,
    ),
    rule(
        "adverbs",
        "The stream flowed quietly.",
        "An adverb-like form or tagged adverb appears. Consider whether it clarifies the action or emphasis; an -ly ending alone does not establish its part of speech.",
        forShortWriting(adverbCue, 40),
        30,
    ),
    rule(
        "prepositions",
        "The book rests beside the window.",
        "A common preposition appears. Check that the location or relationship is clear to a reader; prepositions can have other uses in context.",
        forShortWriting(
            (context) =>
                hasPos("ADP")(context) ??
                textCue(
                    /\b(?:in|on|at|by|with|from|under|over|beside|between|through|after|before)\b/iu,
                )(context),
            40,
        ),
        30,
    ),
    rule(
        "conjunctions",
        "The road is narrow, but the view is wide.",
        "A coordinating or subordinating conjunction appears. Check that it expresses the intended relationship between ideas.",
        forShortWriting(hasPos("CCONJ", "SCONJ"), 40),
        30,
    ),
    rule(
        "compound",
        "We packed early, and we caught the train.",
        "A coordinating conjunction or parsed coordination appears. Check whether the coordination joins ideas of the intended kind.",
        coordinationCue,
        25,
    ),
    rule(
        "complex",
        "When the rain stopped, we continued.",
        "A subordinating marker or parsed dependent-clause relationship appears. Check that the main and supporting ideas are easy to follow.",
        subordinateCue,
        25,
    ),
    rule(
        "capitalnames",
        "Ava met Jordan in Toronto.",
        "A name-like proper noun or capitalized token appears. Review names and place names against the intended spelling; capitalization alone does not verify a name.",
        (context) =>
            tokenCue((item, sentence) => item.pos === "PROPN" && item.start > sentence.start)(
                context,
            ) ?? capitalizedInteriorCue(context),
        5,
    ),
    rule(
        "titles",
        "We discussed *The River Between*.",
        "Formatting that may mark a title appears. Keep the convention consistent with the work type and chosen style guide.",
        contains(/(?:\*[^*\n]{2,}\*|_[^_\n]{2,}_|[“"][^”"]{2,}[”"])/u),
        28,
    ),
    rule(
        "question",
        "Where does the trail begin?",
        "A question mark or interrogative form appears. Check that the sentence asks the question you intend.",
        contains(/\?/u),
        12,
    ),
    rule(
        "instructions",
        "1. Rinse the rice.\n2. Add water.",
        "An ordered-list marker appears. Check that the steps are complete and in an order readers can follow.",
        contains(/^\s*\d+[.)]\s+\S/mu),
        14,
    ),
    rule(
        "description",
        "A narrow stone bridge crosses the river.",
        "Descriptive modifiers appear. Check whether the selected details build a clear picture rather than add unnecessary weight.",
        (context) =>
            hasPos("ADJ", "ADV", "NUM")(context) ??
            prenominalModifier(context) ??
            adverbCue(context),
        25,
    ),
    rule(
        "narrative",
        "Yesterday, Mira opened the gate. Then she ran inside.",
        "Past-time or event-order cues appear. Check that readers can follow the events and any intentional time shifts.",
        contains(/\b(?:yesterday|once|then|afterward|later|finally)\b/iu),
        10,
    ),
    rule(
        "dialogue",
        "“I found it,” Sam said.",
        "Quoted language appears with a speech verb. Check that the dialogue helps readers understand the scene or speaker.",
        contains(/[“"][^”"]+[”"]\s*,?\s*\p{Lu}[\p{L}'’-]*\s+(?:said|asked|replied|shouted)\b/iu),
        12,
    ),
    rule(
        "pointview",
        "I watched the lights fade.",
        "A first-person or second-person reference appears. Check that the perspective stays clear where the text requires consistency.",
        contains(/\b(?:I|me|my|mine|we|us|our|you|your|yours)\b/u),
        15,
    ),
    rule(
        "audience",
        "You can follow these steps without special tools.",
        "Direct address appears. Consider whether it suits the intended reader and setting; this check cannot infer the actual audience.",
        contains(/\b(?:you|your|dear reader|readers)\b/iu),
        28,
    ),
    rule(
        "purpose",
        "In this guide, we explain how the filter works.",
        "A writing intent was selected for this analysis. Review whether the structure and details serve that purpose; the app cannot infer intent from wording alone.",
        ({ text, writingIntent }) =>
            writingIntent !== "general" && text.trim()
                ? { start: 0, end: Math.min(text.length, 1) }
                : undefined,
        35,
    ),
    rule(
        "claims",
        "We argue that protected crossings should be added.",
        "A position or recommendation cue appears. Check that the claim is focused and that the text gives readers reasons to consider it.",
        contains(
            /\b(?:I argue|we argue|should|ought to|must|in my view|the evidence suggests)\b/iu,
        ),
        14,
    ),
    rule(
        "evidence",
        "The survey found that 64 percent of riders wait more than ten minutes.",
        "A quantity or source-attribution cue appears. Check the evidence's source, scope, and connection to the point being made.",
        contains(
            /\b(?:\d+(?:\.\d+)?\s*(?:%|percent|people|students|riders|cases)|according to|the study|the survey|the report)\b/iu,
        ),
        10,
    ),
    rule(
        "counterargument",
        "Some residents oppose the plan; however, the trial could reduce cost.",
        "An opposing-view or concession cue appears. Check whether the alternative view is represented fairly and answered with reasons.",
        contains(
            /\b(?:some (?:people|readers|residents|researchers) (?:argue|believe|may|might)|critics (?:argue|say)|although|while|on the other hand|however|despite)\b/iu,
        ),
        8,
    ),
    rule(
        "sources",
        "According to the 2024 city report, ridership increased.",
        "A source-attribution cue appears. Check that readers can identify the source and distinguish its ideas from your own.",
        contains(
            /\b(?:according to|as reported by|the (?:study|report|survey|author) (?:states|finds|argues|notes))\b|\([^)]*\b(?:19|20)\d{2}\b[^)]*\)/iu,
        ),
        8,
    ),
    rule(
        "paraphrase",
        "According to the report, the route serves more families than before.",
        "Source attribution appears without a nearby direct quotation mark. Check the paraphrase against the original source for accuracy and clear attribution.",
        contains(
            /\b(?:according to|the (?:study|report|author) (?:states|finds|notes))\b(?![^.]{0,100}[“"])/iu,
        ),
        20,
    ),
    rule(
        "synthesis",
        "The city report finds lower traffic, while the university study notes longer travel times.",
        "Two source-attribution cues and a comparison marker appear. Check whether the sources are brought into conversation accurately.",
        contains(
            /\b(?:the (?:city|university|research|recent|first|second) (?:report|study|survey))\b[^.]{0,180}\b(?:while|whereas|similarly|in contrast|both)\b[^.]{0,180}\b(?:study|report|survey|researchers)\b/iu,
        ),
        12,
    ),
    rule(
        "organization",
        "## Problem\nThe road floods.\n\n## Response\nThe city can clear the drains.",
        "Headings or paragraph transitions mark a text structure. Check whether each section advances the overall purpose.",
        contains(/^\s*#{1,6}\s+\S[\s\S]*\n\s*\n|\n\s*\n\s*#{1,6}\s+/mu),
        18,
    ),
    rule(
        "cohesion",
        "The class planted seeds. They watered them each day.",
        "A pronoun or repeated key term links nearby sentences. Check that its reference remains clear to the reader.",
        contains(/\b(?:it|they|them|this|these|those|he|she)\b/iu),
        18,
    ),
    rule(
        "precision",
        "Several people waited near the entrance.",
        "A broad quantity word appears. If the exact amount matters to the reader, consider whether a more precise description is available.",
        contains(/\b(?:many|several|some|a lot|things|stuff|very|really|nice|good|bad)\b/iu),
        28,
    ),
    rule(
        "register",
        "Hello, I am writing to request the records.",
        "A greeting or formal request pattern appears. Check that the level of formality fits the setting and relationship.",
        contains(/\b(?:dear|hello|hi|please|kindly|sincerely|hey|gonna|wanna)\b/iu),
        28,
    ),
    rule(
        "hedging",
        "The results may suggest a change in traffic.",
        "A modal or qualifying phrase appears. Check whether the strength of the wording matches the evidence and uncertainty.",
        contains(
            /\b(?:may|might|could|appears to|seems to|suggests|likely|possibly|perhaps|probably)\b/iu,
        ),
        16,
    ),
    rule(
        "voice",
        "The samples were measured by the research team.",
        "A passive-like construction appears. Check whether foregrounding the affected subject or the actor best serves this sentence; passive voice can be appropriate.",
        passiveCue,
        22,
    ),
    rule(
        "rhetoric",
        "What would change if every street felt safe?",
        "A rhetorical-question form appears. Consider whether the question advances the intended emphasis or invites a response.",
        contains(/\?\s*(?:$|\n)/mu),
        24,
    ),
    rule(
        "poetry",
        "Rain taps softly\non the window",
        "A deliberate-looking line break appears. Review how lineation affects rhythm and emphasis; poetic effect is not automatically assessed.",
        contains(/\S[^\n]*\n(?!\s*\n)\s*\S/u),
        30,
    ),
    rule(
        "imagery",
        "Warm cinnamon steam clouded the window.",
        "A sensory or concrete-detail cue appears. Check whether it creates the experience or image you intend.",
        contains(
            /\b(?:looks?|sounds?|smells?|tastes?|feels?|warm|cold|rough|bright|dark|soft|sharp|steam|scent|echo|glow|texture)\b/iu,
        ),
        25,
    ),
    rule(
        "reflection",
        "I realized the failed test changed my approach.",
        "A first-person reflection cue appears. Check whether it connects the experience to a clear insight or question.",
        contains(
            /\b(?:I|we)\s+(?:realized|learned|noticed|wondered|understood|now see|have come to)\b/iu,
        ),
        18,
    ),
    rule(
        "revision",
        "I moved the example earlier so readers see the claim first.",
        "A revision-process statement appears. Check whether the change improves the intended meaning or organization.",
        contains(/\b(?:I|we)\s+(?:revised|moved|changed|removed|added|reordered|rewrote)\b/iu),
        28,
    ),
    rule(
        "feedback",
        "I used the feedback to clarify the second paragraph.",
        "A response-to-feedback statement appears. Check that the revision addresses useful feedback while retaining intentional choices.",
        contains(
            /\b(?:feedback|reviewer|reader response)\b[^.]{0,100}\b(?:used|changed|revised|clarified|kept|rejected)\b|\b(?:used|revised|changed)\b[^.]{0,100}\bfeedback\b/iu,
        ),
        28,
    ),
    rule(
        "genre",
        "## Method\nWe recorded the temperature every hour.",
        "A heading or list structure appears. Check whether it supports the conventions readers expect for this genre.",
        contains(/^\s*#{1,6}\s+\S|^\s*[-*+]\s+\S/mu),
        32,
    ),
    rule(
        "accessibility",
        "## Getting started\n1. Open the settings page.\n2. Choose a language.",
        "Headings or numbered steps can support navigation. Check whether labels and section structure help readers find what they need.",
        contains(/^\s*(?:#{1,6}\s+\S|\d+[.)]\s+\S)/mu),
        26,
    ),
    rule(
        "ethics",
        "The small survey may not represent every resident.",
        "A scope or qualification cue appears. Check that people, sources, and limits are represented fairly; this local check cannot assess ethical adequacy.",
        contains(
            /\b(?:may not represent|limited sample|not all|some participants|according to|reported by)\b/iu,
        ),
        35,
    ),
    rule(
        "metacognition",
        "I chose a shorter opening to make the request clear.",
        "A writer's choice and intended effect are named. Check whether the stated choice achieves that effect for the intended reader.",
        contains(/\b(?:I|we)\s+(?:chose|decided|intended|wanted|aimed)\b/iu),
        30,
    ),
    rule(
        "negation",
        "Not every visitor stayed until closing.",
        "A negative word appears. Check exactly which idea is negated; a small change in scope can alter the meaning.",
        contains(/\b(?:not|never|no|none|neither|nor|without)\b/iu),
        18,
    ),
    rule(
        "mood",
        "Please close the gate before leaving.",
        "A directive or modal verb appears. Check whether the sentence expresses the intended request, fact, wish, or possibility.",
        contains(
            /^(?:\s*(?:please\s+)?(?:close|open|consider|remember|use|avoid|let|do)\b|[^.?!]*\b(?:if I were|I wish|could|would|should)\b)/imu,
        ),
        22,
    ),
    rule(
        "conditionals",
        "If the path is open, we will take it.",
        "A conditional marker appears. Check that the condition and result express the intended time and likelihood relationship.",
        contains(
            /\b(?:if|unless|provided that|as long as)\b[^.?!]{0,180}\b(?:will|would|can|could|then|may|might)\b/iu,
        ),
        16,
    ),
    rule(
        "reported-tense",
        "She said that the doors were locked.",
        "A reporting verb and reported clause appear. Check that the time relationship reflects what was said or thought.",
        contains(
            /\b(?:said|told|thought|believed|reported|explained)\b[^.?!]{0,80}\b(?:that|was|were|had|is|are)\b/iu,
        ),
        24,
    ),
    rule(
        "infinitives",
        "They decided to leave before noon.",
        "A to-infinitive pattern appears. Check that the governing word licenses this construction and that the intended time is clear.",
        contains(/\bto\s+\p{L}{2,}\b/iu),
        30,
    ),
    rule(
        "restrictive-clauses",
        "The book that I borrowed is here.",
        "A relative clause appears to identify a noun. Punctuation can change meaning, so review whether the clause is identifying or additional information.",
        contains(
            /\b(?:that|who|which|whose)\b[^,.;!?]{1,100}\b(?:is|was|are|were|has|have|had|can|will|did|does)\b/iu,
        ),
        26,
    ),
    rule(
        "nonrestrictive-clauses",
        "The book, which I borrowed yesterday, is here.",
        "A comma-delimited relative clause appears. Check whether the information is additional rather than necessary to identify the noun.",
        contains(/,\s*(?:which|who|whose)\b[^,.;!?]{1,100},/iu),
        26,
    ),
    rule(
        "appositives",
        "Maya, our new neighbor, brought soup.",
        "A comma-delimited noun phrase may be an appositive. Review punctuation against whether the identifying information is essential to meaning.",
        contains(/,\s+(?:a|an|the|my|our|his|her|their|[A-Z][\p{L}'’-]+)\b[^,.;!?]{1,60},/u),
        28,
    ),
    rule(
        "paragraph-focus",
        "The bus stop lacks shelter. Riders wait in the rain. The route serves three schools.",
        "A paragraph contains multiple sentences and recurring noun references. Check that the details develop the same main point or signal a clear shift.",
        contains(/\S[^\n]*\.\s+[^\n]*\b(?:the|this|these|route|school|people|study|report)\b/iu),
        28,
    ),
    rule(
        "tone-consistency",
        "Therefore the proposal is sound, but the rollout is kinda messy.",
        "Formal and informal wording both appear. Check whether the shift is intentional and suitable for the audience.",
        contains(
            /\b(?:therefore|regarding|approximately|consequently)\b[^.?!]{0,120}\b(?:kinda|gonna|wanna|awesome|stuff|super)\b|\b(?:kinda|gonna|wanna|awesome|stuff|super)\b[^.?!]{0,120}\b(?:therefore|regarding|approximately|consequently)\b/iu,
        ),
        34,
    ),
    rule(
        "commentary",
        "The survey found longer waits. This suggests that service frequency may be insufficient.",
        "A result is followed by an interpretive phrase. Check whether the commentary explains how the evidence supports the point.",
        contains(
            /\b(?:this|these|the finding|the result)\b[^.?!]{0,120}\b(?:suggests|shows|means|indicates|matters|supports)\b/iu,
        ),
        20,
    ),
    rule(
        "interpretation",
        "The repeated image of winter suggests isolation.",
        "An interpretive verb appears near a textual feature. Check that the interpretation is supported by details in the work.",
        contains(/\b(?:suggests|implies|reveals|symbolizes|represents|conveys|underscores)\b/iu),
        22,
    ),
    rule(
        "reasoning",
        "The route floods; therefore, the drains need repair.",
        "A logical or causal connector appears. Check whether the stated reason supports the conclusion rather than only preceding it.",
        contains(/\b(?:because|therefore|thus|so|as a result|consequently|this means)\b/iu),
        14,
    ),
    rule(
        "evidence-relevance",
        "The claim concerns bus access, and the survey reports a long wait.",
        "A claim-like phrase and an evidence-like phrase both appear. Review whether the evidence is relevant and sufficient; the app cannot establish that relationship semantically.",
        contains(
            /\b(?:claim|argue|should)\b[^.?!]{0,160}\b(?:evidence|survey|study|report|data)\b|\b(?:evidence|survey|study|report|data)\b[^.?!]{0,160}\b(?:claim|argue|should)\b/iu,
        ),
        24,
    ),
    rule(
        "rhetorical-situation",
        "You can use this notice to find a safe route home.",
        "Direct address and an apparent purpose cue appear. Check whether the choices fit the actual audience and situation; those facts are not inferred.",
        contains(
            /\b(?:you|your|readers)\b[^.?!]{0,150}\b(?:guide|notice|explain|help|use|learn|find)\b/iu,
        ),
        34,
    ),
    rule(
        "causal-reasoning",
        "The delay followed the storm, but the report does not show that the storm caused it.",
        "A causal relationship is stated or qualified. Check whether the evidence supports causation rather than sequence or correlation.",
        contains(
            /\b(?:caused|causes|because of|led to|resulted in|due to|correlat\w*|followed by)\b/iu,
        ),
        14,
    ),
    rule(
        "source-evaluation",
        "According to a 2024 survey of 180 residents, most supported the change.",
        "A source or citation cue appears. Review its author, date, method, scope, and relevance; this local check cannot verify credibility.",
        contains(
            /\b(?:according to|survey|study|report|research|author)\b|\([^)]*\b(?:19|20)\d{2}\b[^)]*\)/iu,
        ),
        10,
    ),
];

export function writingGoalObservations(
    sentences: readonly Sentence[],
    text: string,
    writingIntent: WritingIntent,
    maximum = 8,
): Diagnostic[] {
    if (!text.trim() || maximum <= 0) return [];
    const context: GoalCueContext = { text, sentences, writingIntent };
    const candidates = writingGoalCueRules
        .map((rule) => ({ rule, span: rule.detect(context) }))
        .filter((entry): entry is { rule: WritingGoalCueRule; span: Span } => Boolean(entry.span))
        .sort((a, b) => a.rule.priority - b.rule.priority || a.span.start - b.span.start);
    const matched: typeof candidates = [];
    const coveredSentences = new Set<number>();
    for (const candidate of candidates) {
        const sentenceIndex = sentences.findIndex(
            (sentence) =>
                candidate.span.start < sentence.end && candidate.span.end > sentence.start,
        );
        if (sentenceIndex >= 0 && coveredSentences.has(sentenceIndex)) continue;
        matched.push(candidate);
        if (sentenceIndex >= 0) coveredSentences.add(sentenceIndex);
        if (matched.length >= maximum) break;
    }
    return matched.map(({ rule, span }) => ({
        ...span,
        id: `${rule.id}:${span.start}:${span.end}`,
        ruleId: rule.id,
        goalId: rule.goalId,
        category: "Style",
        skill: "usage",
        title: "Review a writing cue",
        explanation: rule.prompt,
        certainty: "Style suggestion",
        evidence: [{ ...span, label: "Observed text cue" }],
        confidence: {
            policy: "Deterministic surface cue for optional review; not a mastery judgment or quality assessment.",
            calibrated: false,
            scope: "Text evidence only; intent and meaning may require human review.",
        },
        proposals: [],
    }));
}
