import {
    ALL_SBI_CARDS,
    CORPORATE_CARDS
} from '../config/cards.js';

function resolveEligibleCards(applicableText) {
    let eligibleCards = [];
    let excludedCards = [];
    const lowerText = applicableText.toLowerCase();

    const exclMatch = applicableText.match(/All SBI Credit Cards excluding ([^\n]+)/i);
    if (exclMatch) {
        let exclusionRaw = exclMatch[1].split(/ and on | and for | and at | except | except for | valid | offer | summary|\(|\.|\n|\r|\[|\{|\*/i)[0];
        let excluded = exclusionRaw
            .split(/,|&| and /i)
            .map(card => card.trim())
            .filter(Boolean);
        let hasCorporate = excluded.some(card => card.toLowerCase().includes('corporate card'));
        let namedExclusions = excluded.filter(card => !card.toLowerCase().includes('corporate card'));
        excludedCards = [];
        if (hasCorporate) {
            excludedCards = [...CORPORATE_CARDS];
        }
        excludedCards = [
            ...excludedCards,
            ...namedExclusions
        ];
        excludedCards = Array.from(new Set(excludedCards));
        eligibleCards = ALL_SBI_CARDS.filter(card => !excludedCards.includes(card));
        return {
            eligibleCards,
            excludedCards
        };
    }

    if (lowerText.includes('all sbi credit cards excluding corporate cards')) {
        eligibleCards = [...ALL_SBI_CARDS];
        excludedCards = [...CORPORATE_CARDS];
        return {
            eligibleCards,
            excludedCards
        };
    }

   const specificMatch = applicableText.match(/SBI (?:Card|Cards)? ([^\n]+)$/i);
   if (specificMatch) {
       const listed = specificMatch[1]
           .split(',')
           .map(card => 'SBI ' + card.trim());

       eligibleCards = listed;

       excludedCards = ALL_SBI_CARDS.filter(card => !listed.includes(card));

       return {
           eligibleCards,
           excludedCards
       };
   }


    eligibleCards = [...ALL_SBI_CARDS];
    excludedCards = [];
    return {
        eligibleCards,
        excludedCards
    };
}

export {
    resolveEligibleCards
};