'use strict';

const UTF8_PREAMBLE='[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Text.UTF8Encoding]::new($false);';

function withUtf8Output(script){return `${UTF8_PREAMBLE}${String(script)}`;}

module.exports={UTF8_PREAMBLE,withUtf8Output};
