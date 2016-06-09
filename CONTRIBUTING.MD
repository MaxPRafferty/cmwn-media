# CMWN Javascript Style Guide

## The Golden Rule

Borrowed from the excellent commuinty style guide [idiomatic.js](https://github.com/rwaldron/idiomatic.js/#dont-do-stupid-shit-and-everything-will-be-ok):   
 > "**Don't do stupid shit and everything will be ok**"   
 
 Common sense should be the rule of the land. We are attempting to make a large codebase appear as if it were crafted by a single hand, and there will be issues not covered by this guide. If you are unsure about a decision you are making, just ask someone. We are all in this together.

## Overview
As a general rule, all Javascript code being contributed to CMWN should follow the rules outlined in this document. For any rules not specified here, style rules should conform to the [Standard Javascript Style](http://standardjs.com/rules.htmlhttp://standardjs.com/rules.html). For arbitrary style choices (e.g. tabs vs spaces) we defer to [PHP PSR1](http://www.php-fig.org/psr/psr-1/) and [PHP PSR2](http://www.php-fig.org/psr/psr-2/) for maximum overall consistency across all repositories whenever possible. CMWN JS is also following the [ECMAScript 2015 standard](https://babeljs.io/docs/learn-es2015/) (formerly ES6), and any syntax supported by this standard is allowed.
   
A breif summary of the Standard JS style rules followed by this repository:
 - Always use single quotes
 - No unused variables
 - Add a space after all keywords (`if (condition) {...}`)
 - Add a space before a function declaration's parenthesese (`function name (arg) { ... }`)
 - Always use `===` instead of `==` except to check for null and undefined simultaneously (`somevar == null`)
 - Infix operators must be spaced (`var message = 'hello, ' + name + '!'`)
 - Commas should always have a space after them
 - Else statements should be on the same line as their curly braces
 - Wrap any multiline block in curly braces
 - Keep single line if statements on the same line as the if statement. If the line is too long, wrap in curly braces
 - No Pokemon error handling (gotta catch em all!) - always handle the err function parameter
 - Always prefix globals with window (`window.alert('good')`)
 - Write each var declaration in its own statement
 - Wrap conditional assignments with additional parentheses to indicate they are intentional (`while ((m = text.match(expr))) {`)
 
 
We diverge from the standard JS style in the following ways:

 - End every line with a semicolon (Style should not increase number of considerations for avoiding bugs)
 - Indent with 4 spaces (to match PSR1 across the codebase)
 - Multiple blank lines are fine (format as you will)
 - Do not precede ternary conditions on multiple lines with the `?` and `:` operators
 
We additionally define the following rules:

 - Declare all variables at the top of their scope
 - Use dot notation to access object properties whenever possible
 - End all files with a blank newline
 - No line should exceed 110 characters (width of the GitHub code viewer)
 - No file should exceed 500 lines
 - When including JSDoc comments, they must be valid
 - Always wrap immediately invoked functional expressions in parentheses
 - Do not declare functions inside of loops
 - Always use a Radix when calling `Number()`
 - Do not shadow variables in nested scopes
 - Declare constants all uppercase replacing spaces with underscores (snake case)
 - Declare normal variables in camel case
 - All files should be named all lowercase with snake case
 - Wrap regular expressions in parentheses
 - Add spaces around the arrow operator
 - Do not modify variables declared const
 - Do not duplicate class member names
 - Do not access `this` before calling `super()` in a class function
 

## Acceptable shorthand

There are a few useful shortcuts for common tasks that are unorthodox but easy to identify and use if you are aware of them:
 
  - Use the unary + to cast to a number (`+'3' === 3`) (Be aware of the [NaN results of this operation](http://jibbering.com/faq/notes/type-conversion/#tcNumber), however, and consider the other choices available in `Number()`, `ParseInteger()`, and `ParseNumber()`)
  - Use the bitwise NOT (`~`) operator to quickly check the results of an .indexOf operation (e.g. `~'asdf'.indexOf('q') === 0`) (for your own edification, this works because the only number that becomes falsy after a bitwise NOT in the twos-compliment binary representation is -1)
  - Use double NOT (`!!`, "bangbang") to cast to a boolean

## Further Reading

Most of our style rules have been taken from one of the two following sources. If you come across something not in StandardJS or PSR1, these two guides are good sources for well thought out, in depth discussions of the merits and reasons for a variety of JavaScript style choices:

- [Idiomatic.JS](https://github.com/rwaldron/idiomatic.js/) - Open source, community JS language and usage standards
- [AirBnB Style Guide](https://github.com/airbnb/javascript/tree/master/es5) - AirBnB's open source style guide. Goes deep into all aspects of using the JS language.
