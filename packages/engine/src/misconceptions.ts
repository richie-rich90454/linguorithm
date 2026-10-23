/** Option-specific explanations describe the actual misconception, never a generic retry message. */
export const misconceptions: Record<string, Record<number, string>> = {
    "agreement-1": {
        0: "“Are” agrees with the nearby plural “essays”, but the subject is “collection”.",
        2: "“Were” is plural; the singular past form would be “was”.",
        3: "“Have been” is plural. A singular subject would take “has been”.",
    },
    "agreement-2": {
        0: "“Takes” is singular, while “students” is plural.",
        1: "“Taking” is a participle and cannot supply the finite verb by itself.",
        3: "“Has taken” is singular and perfect, while the question asks for the plural present tense.",
    },
    "agreement-3": {
        0: "“Produce” does not agree with the singular head “each”.",
        2: "“Producing” needs a finite auxiliary to complete the predicate.",
        3: "“Have produced” is plural; the head “each” is singular.",
    },
    "sentence-1": {
        0: "The clause has a subject: “the experiment”.",
        1: "“Was successful” contains a finite verb and a subject complement; verb count is not the problem.",
        3: "A short sentence can be complete. The dependency introduced by “although” is the problem.",
    },
    "sentence-2": {
        0: "“Researchers” names the people performing the action; it is the subject noun.",
        2: "“Their” is a possessive determiner, not an action carrying tense.",
        3: "“Hypothesis” is the object of the verb, not the finite verb itself.",
    },
    "boundaries-1": {
        1: "The semicolon splits the subject “evidence” from its predicate “was limited”.",
        2: "Removing the comma leaves two independent clauses without a joining boundary.",
        3: "A comma after “was” separates the verb from its complement and leaves the clauses unjoined.",
    },
    "boundaries-2": {
        0: "“However” is a conjunctive adverb; a comma before it cannot independently join the clauses.",
        2: "“Because of” takes a noun phrase, rather than the complete clause that follows.",
        3: "“Despite” takes a noun phrase or gerund, rather than a complete finite clause.",
    },
    "punctuation-1": {
        0: "The subject “findings” should stay connected to “deserve”. The opening transition needs the comma.",
        2: "Putting a comma after “deserve” separates the verb from its object.",
        3: "Here “However” functions as an introductory transition and needs a comma.",
    },
    "punctuation-2": {
        1: "“The team celebrated” has both a subject and a finite verb, so it is not a fragment.",
        2: "Semicolons mark relationships between clauses; they do not automatically follow verbs.",
        3: "The subjects are different: “experiment” and “team”. Shared subjects are not required.",
    },
    "verbs-1": {
        0: "“Wrote” is the simple past; after perfect “has”, use the participle.",
        1: "“Write” is the base form, rather than the past participle.",
        3: "“Writing” would need “been” in a progressive perfect construction.",
    },
    "verbs-2": {
        0: "The third-person ending -s does not follow a modal auxiliary.",
        1: "The past-tense form does not directly follow “should”.",
        2: "The participle -ing would need an additional auxiliary, such as “be”.",
    },
    "pronouns-1": {
        0: "“I” is a subject pronoun; the phrase needs an object of “between”.",
        2: "The reflexive “myself” has no local first-person subject to refer back to here.",
        3: "“Mine” is possessive; it cannot serve as the intended personal object of “between”.",
    },
    "pronouns-2": {
        1: "Changing to “they” does not reliably identify which person finished the project.",
        2: "Removing all pronouns is unnecessary and may make writing awkward.",
        3: "Commas do not establish the intended antecedent, and commas after every noun would be incorrect.",
    },
    "usage-1": {
        0: "The letter u can represent a consonant opening sound. In “useful”, it begins with /y/.",
        2: "“These” is plural, while “explanation” is singular.",
        3: "“Those” is plural, while “explanation” is singular.",
    },
    "usage-2": {
        0: "“Affect” is usually a verb meaning influence; its specialist noun sense is not the intended meaning here.",
        2: "“Effective” is an adjective and needs a noun to modify in this position.",
        3: "“Affecting” does not supply the noun in the standard expression “have an effect on”.",
    },
    "sentence-3": {
        0: "Length alone cannot make a phrase complete; the imperative structure matters.",
        2: "“Listen” is a verb expressing a command.",
        3: "Punctuation marks a boundary but cannot supply missing grammatical structure.",
    },
    "agreement-4": {
        0: "The plural noun “students” belongs to the relative clause; the main subject is “book”.",
        1: "“Were” is plural in an ordinary statement, while “book” is singular.",
        3: "“Have been” is plural, while the singular subject would take “has been”.",
    },
    "boundaries-3": {
        0: "“Because the road” has no finite predicate and is only part of the dependent clause.",
        1: "“Because” makes this a dependent clause, even though it contains a subject and verb.",
        3: "“Was flooded” is a predicate without its own subject.",
    },
};
