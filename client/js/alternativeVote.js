(function (exports) {
  /**
   * Class representing a candidate.
   * @typedef {Object} Candidate
   * @property {String} name The name of the candidate.
   * @property {Number} id The candidate's unique identifying number.
   * */
  exports.Candidate = class Candidate {
    /**
     * Creates a new candidate.
     * @param {String} name The name of the candidate.
     * @param {Number} id The candidate's unique identifying number.
     */
    constructor (name, id) {
      this.name = name
      this.id = id
    }
  }
  /**
   * Class representing an election.
   * @typedef {Object} Election
   * @property {Number} code The election's unique identifying code.
   * @property {Candidate[]} candidates The candidates running in the election
   * @property {Number[][]} ballots The ballots submitted by voters in the election—
   *  arrays containing the candidates' IDs in order of most to least favorable to the voter
   * @property {Number[]} voters A list of voter ID numbers to track who has voted and insure against duplicate votes.
   */
  exports.Election = class Election {
    /**
     * Creates an election.
     * @param {Number} code The election's unique identifying code.
     * @param {Candidate[]} candidates The candidates running in the election
     * @param {Object[]} creatorInfo an array whose first element is the fingeprint of the creator, and whose second element is the creator's public key (for verification purposes)
     * @param {Number[][]} ballots The ballots submitted by voters in the election—
     *  arrays containing the candidates' IDs in order of most to least favorable to the voter
     * @param {String[]} voters A list of voter ID numbers to track who has voted and insure against duplicate votes.
     * @param {Function} printFunc the function to call to print live AV output (must accept a String)
     */
    constructor (code, candidates, creatorInfo, ballots, voters, printFunc) {
      this.code = code
      this.candidates = candidates
      this.ballots = ballots
      this.voters = voters
      this.creatorFingerprint = creatorInfo[0]
      this.creatorPubKey = creatorInfo[1]
      this.printFunc = printFunc
      // Used to determine whether a vote count has been scheduled on this election
      this.countPending = false
    }

    /**
     * Checks whether a given voter has already voted.
     * @param {String} id A voter's hexadecimal fingerprint.
     * @returns {Boolean} True if the voter has already voted, false if they have not.
     */
    hasVoted (id) {
      return this.voters.indexOf(id) > -1
    }

    /**
     * Adds a voter's fingerprint to the voter ID list and shuffles it to ensure anonymity.
     * @param {String} id A voter's hexadecimal fingerprint.
     */
    addVoterID (id) {
      this.voters.push(id)
      exports.shuffleArray(this.voters)
    }
  }

  exports.shuffleArray = function (array) {
    let i = 0
    let j = 0
    let temp = null
    for (i = array.length - 1; i > 0; i -= 1) {
      j = Math.floor(Math.random() * (i + 1))
      temp = array[i]
      array[i] = array[j]
      array[j] = temp
    }
  }

  /**
   * Returns the winner of an election as per the alternative/instant-runoff vote algorithm.
   * @param {Election} election the election the winner of which to find
   * @returns {Candidate} the candidate who wins the election
   */
  exports.alternativeVote = function (election) {
    let printFunc = election.printFunc
    printFunc('---BEGINNING ELECTION---')
    let candidates = JSON.parse(JSON.stringify(election.candidates))
    let ballots = JSON.parse(JSON.stringify(election.ballots))

    const droopQuota = Math.floor(ballots.length / 2) + 1
    printFunc('Droop quota set at ' + droopQuota)
    /**
     * Gets the Candidate object with the specified ID
     * @param {Number} id the ID of the candidate to find
     * @returns {Candidate} the Candidate with the appropriate ID
     */
    function findCandidateWithId (id) {
      return candidates.find(cand => cand.id === id)
    }

    let totals = {}
    for (let cand of candidates) {
      totals[cand.id] = []
    }
    printFunc('Cand IDs in election:' + Object.keys(totals).map(e => ` ${findCandidateWithId(parseInt(e)).name} (${e})`))

    /**
     * (Re)distributes votes in the totals object.
     * @param {Number[]} votes an array of voting ballots
     * @param {Object} mapObj an object containing candidate keys and ballot values into which results will be passed.
     * @param {Number} candIdToDelete pass this to delete a candidate. If this is passed, candidates will be checked for existence during redistribution.
     *  Otherwise, it is assumed that this is an initial distribution and checks will not be performed. If this is a runoff, pass -1 to have checking performed without deleting a candidate.
     */
    function redistributeVotes (votes, mapObj, candIdToDelete) {
      const candIdToDeleteExists = candIdToDelete !== null && candIdToDelete !== undefined

      ballotLoop: // eslint-disable-line no-labels
      for (let ballot of votes) {
        if (ballot[0] !== undefined) {
          let electee = ballot.shift()
          // as stated in the function JSDoc, if we're deleting it means we're mid-election and we need to verify that the next place person exists
          // if there is no candIdToDelete, we assume this is an initial "total filling" and don't waste time with verification
          if (candIdToDeleteExists) {
            // Keep going through the ballot until it's exhausted or we find a candidate who's still in the election
            while (!(electee in mapObj)) {
              electee = ballot.shift()
              if (electee === undefined) {
                // we've exhausted the ballot—it contains no one who's still in the election, so it's thrown away
                continue ballotLoop // eslint-disable-line no-labels
              }
            }
          }
          if (electee in mapObj) mapObj[electee].push(ballot)
        }
      }
      if (candIdToDeleteExists && candIdToDelete in mapObj) {
        delete mapObj[candIdToDelete]
      }
    }

    /**
     * Determines the winner or biggest losers of a set of candidates.
     * @param {Number[]} candIds the candidates to consider.
     * @param {Object} mapObj an object containing candidate keys and ballot values.
     */
    function findWinnerOrLosers (candIds, mapObj) {
      let res = {'candidates': [], 'type': ''}
      let minVotes
      let lowestCands = []
      for (let candId of candIds) {
        candId = parseInt(candId)
        let curTotal = mapObj[candId].length
        printFunc('Cand ID ' + candId + ' has ' + curTotal + ' votes')
        // If they have a majority, they win
        if (curTotal >= droopQuota) {
          printFunc('WINNER: Cand ID ' + candId + ' has a majority with ' + curTotal + ' votes')
          res.type = 'winner'
          res.candidates = [candId]
          return res
        }

        if (curTotal < minVotes || minVotes === undefined) {
          // If they're lower than the min, or min hasn't yet been set, they're the new min
          minVotes = curTotal
          lowestCands = [candId]
        } else if (curTotal === minVotes) {
          // If they're equal to the min, we might have a tie for last—keep track of all potential losers
          lowestCands.push(candId)
        }
      }
      res.type = 'loser'
      res.candidates = lowestCands
      return res
    }

    // initial vote distribution—nobody gets deleted
    redistributeVotes(ballots, totals)

    // check for majority and find biggest loser
    while (Object.keys(totals).length > 1) {
      printFunc('Current distributon: ' + Object.keys(totals).reduce((a, b) => a + `${b}: ${totals[b].map(e => '[' + e + ']')}; `, ''))
      let candIds = Object.keys(totals)
      let roundResult = findWinnerOrLosers(candIds, totals)
      if (roundResult.type === 'winner') {
        return findCandidateWithId(roundResult.candidates[0])
      }

      let lowestCands = roundResult.candidates
      if (lowestCands.length > 1) {
        printFunc('Preparing for runoff among: ' + lowestCands)
        let runoffBallots = []
        let runoffTotals = Object.assign({}, totals)
        // TODO: Should we reallot all ballots or do it this way (just putting other candidates' into the pool so that we can keep first-place choices with first-place candidates)?
        // Make runoffTotals only include entries for the candidates in the runoff
        for (let cand in runoffTotals) {
          cand = parseInt(cand)
          if (!lowestCands.includes(cand)) {
            runoffBallots.concat(runoffTotals[cand])
            delete runoffTotals[cand]
          }
        }

        // While there are >1 biggest losers and there is still at least one ballot to redistribute, keep trying runoffs
        while (lowestCands.length > 1 && runoffBallots.findIndex(e => e.length > 0) > -1) {
          // Break a tie between multiple candidates with fewest votes
          printFunc('Beginning runoff redistribution')
          redistributeVotes(runoffBallots, runoffTotals)
          let runoffResults = findWinnerOrLosers(lowestCands, runoffTotals)
          lowestCands = runoffResults.candidates
        }

        // Randomly eliminate a candidate in event of a tie
        if (lowestCands.length > 1) {
          printFunc('Will randomly break loser tie among: ' + lowestCands)
          exports.shuffleArray(lowestCands)
        }
      }

      printFunc('Biggest loser for this round is ' + lowestCands[0])
      printFunc('***Redistributing***')
      redistributeVotes(totals[lowestCands[0]], totals, lowestCands[0])
    }
    // if only one candidate remains, they win automatically
    printFunc('WINNER: Cand ' + Object.keys(totals)[0] + ' is only remaining, wins by default')
    return findCandidateWithId(parseInt(Object.keys(totals)[0]))
  }
})(typeof exports === 'undefined' ? this['AV'] = {} : exports)
