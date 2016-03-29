#!/bin/bash
#
# build_database.sh - create empty temperature database schema for to log temperature in.
#
# Tom Holderness 22/01/2012
sqlite3 piTemps.db 'DROP TABLE IF EXISTS temperature_records;'
sqlite3 piTemps.db 'CREATE TABLE temperature_records(unix_time bigint primary key, top real, bottom real, [in] real, out real);' 

