(function(root,factory){
  var api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.BilalNearCore=api;
})(typeof globalThis!=='undefined' ? globalThis : typeof self!=='undefined' ? self : this,function(){
  'use strict';

  var PRAYERS=['fajr','dhuhr','asr','maghrib','isha'];

  function validDate(d){ return d instanceof Date && !isNaN(d.getTime()); }
  function pad(n){ return n<10 ? '0'+n : String(n); }
  var zoneDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
  var zoneTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function dateKey(d){ return zoneDate.format(d); }
  function rowKey(row,prayer){ return String(row.date||'')+'/'+prayer; }
  function wallMinutes(d){ var t=zoneTime.format(d).split(':'); return Number(t[0])*60+Number(t[1]); }

  /* A jama'ah just after midnight belongs after a begins time just before
     midnight. Smaller negative gaps are genuinely backwards. */
  function offsetMinutes(begins,jamaah){
    var n=(jamaah.getTime()-begins.getTime())/60000;
    if(n < -720) n+=1440;
    return n;
  }

  function effectiveJamaah(begins,jamaah){
    if(validDate(begins) && validDate(jamaah) && jamaah.getTime()-begins.getTime() < -720*60000){
      return new Date(jamaah.getTime()+86400000);
    }
    return jamaah;
  }

  function auditRows(rows){
    var bad={}, issues=[], previous={};
    (rows||[]).forEach(function(row){
      PRAYERS.forEach(function(prayer){
        var key=rowKey(row,prayer), begins=row.begins && row.begins[prayer];
        var jamaah=row.jamaah && row.jamaah[prayer];
        if(jamaah && !validDate(jamaah)){
          bad[key]='This time could not be read';
          issues.push({key:key,reason:bad[key]});
          return;
        }
        if(!jamaah) return;
        if(begins && validDate(begins)){
          var offset=offsetMinutes(begins,jamaah);
          if(offset<0){
            bad[key]='Jama\'ah appears before the prayer begins';
          }else if(offset>240){
            bad[key]='Jama\'ah is unusually far after the prayer begins';
          }
          if(bad[key]){
            issues.push({key:key,reason:bad[key]});
            return;
          }
        }

        var prev=previous[prayer];
        if(prev){
          var a=new Date(prev.date+'T12:00:00'), b=new Date(row.date+'T12:00:00');
          var days=Math.round((b-a)/86400000);
          if(days>0 && days<=2){
            var delta=Math.abs(wallMinutes(jamaah)-wallMinutes(prev.jamaah));
            delta=Math.min(delta,1440-delta);
            if(delta>180){
              bad[key]='This time jumps by more than three hours from the previous day';
              issues.push({key:key,reason:bad[key]});
              return;
            }
          }
        }
        previous[prayer]={date:row.date,jamaah:jamaah};
      });
    });
    return {bad:bad,issues:issues};
  }

  function nextJamaah(rows,now){
    var at=typeof now==='number' ? now : now.getTime();
    var audit=auditRows(rows), best=null;
    (rows||[]).forEach(function(row){
      PRAYERS.forEach(function(prayer){
        var q=row.jamaah && row.jamaah[prayer];
        q=effectiveJamaah(row.begins && row.begins[prayer],q);
        if(!validDate(q) || audit.bad[rowKey(row,prayer)] || q.getTime()<=at) return;
        if(!best || q<best.at) best={key:rowKey(row,prayer),prayer:prayer,at:q};
      });
    });
    return best;
  }

  /* The jama'ah that has already been called, if one has. The mirror of
     nextJamaah, and it has to be a mirror: same audit, same midnight-wrap, or
     the two would disagree about the same row and the screen would show a
     prayer as both finished and upcoming. */
  function lastJamaah(rows,now){
    var at=typeof now==='number' ? now : now.getTime();
    var audit=auditRows(rows), best=null;
    (rows||[]).forEach(function(row){
      PRAYERS.forEach(function(prayer){
        var q=row.jamaah && row.jamaah[prayer];
        q=effectiveJamaah(row.begins && row.begins[prayer],q);
        if(!validDate(q) || audit.bad[rowKey(row,prayer)] || q.getTime()>at) return;
        if(!best || q>best.at) best={key:rowKey(row,prayer),prayer:prayer,at:q};
      });
    });
    return best;
  }

  /* THE SALAH PHASE. Which side of the congregation this moment is on.
     Sakib, 26 Aug: during and just after jama'ah the screen should say so and
     send people to other mosques, rather than counting down to a prayer that
     has already started.

     Three phases, and the middle one is the whole point:

       waiting  — a jama'ah is ahead. Today's behaviour, unchanged.
       praying  — the jama'ah has been called and the congregation is still
                  standing. `next` is deliberately carried alongside, because
                  the honest thing to offer here is somewhere else to go.
       none     — nothing published ahead and nothing recent behind.

     `minutes` is how long a congregation is assumed to stand, not a fact about
     any mosque: 15 by default because that is the figure the decision was
     taken on, a parameter because jumu'ah is longer and fajr is shorter, and
     no source Bilal holds publishes a duration. Treat it as the screen's
     assumption, and let a caller that knows better say so.

     Deliberately NOT a judgement about whether anyone can still make it. That
     judgement needs a travel time and belongs to the caller; this function
     only answers where the moment sits. */
  function salahPhase(rows,now,minutes){
    now=typeof now==='number' ? now : (validDate(now) ? now.getTime() : NaN);
    if(!isFinite(now)) return {phase:'none',prayer:null,at:null,endsAt:null,next:null};
    var span=(typeof minutes==='number' && isFinite(minutes) && minutes>0 ? minutes : 15)*60000;
    var next=nextJamaah(rows,now), last=lastJamaah(rows,now);
    if(last){
      var endsAt=new Date(last.at.getTime()+span);
      if(now < endsAt.getTime()){
        return {phase:'praying',prayer:last.prayer,at:last.at,endsAt:endsAt,next:next};
      }
    }
    if(next) return {phase:'waiting',prayer:next.prayer,at:next.at,endsAt:null,next:next};
    return {phase:'none',prayer:null,at:null,endsAt:null,next:null};
  }

  /* The answer can point at tomorrow without turning tonight into daytime.
     Atmosphere follows the prayer window we are living in, not the next
     jama'ah in the queue. Begins is the closer proxy for the sky; jama'ah is
     only a fallback for directories that do not publish separate starts. */
  function currentAtmosphere(rows,now){
    now=typeof now==='number' ? new Date(now) : now;
    if(!validDate(now)) return 'isha';
    var today=dateKey(now), row=null, i;
    for(i=0;i<(rows||[]).length;i++){
      if(rows[i].date===today){ row=rows[i]; break; }
    }

    var current='isha';
    if(row){
      PRAYERS.forEach(function(prayer){
        var begins=row.begins && row.begins[prayer];
        var jamaah=row.jamaah && row.jamaah[prayer];
        var transition=validDate(begins) ? begins : jamaah;
        if(validDate(transition) && transition.getTime()<=now.getTime()) current=prayer;
      });
      return current;
    }

    /* Honest fallback when today's row is absent. It keeps late night dark
       and avoids borrowing the colour of a future result. */
    var hour=Math.floor(wallMinutes(now)/60);
    if(hour<5) return 'isha';
    if(hour<8) return 'fajr';
    if(hour<15) return 'dhuhr';
    if(hour<19) return 'asr';
    if(hour<21) return 'maghrib';
    return 'isha';
  }


  /* ── Where the sun actually is ────────────────────────────────────────
     Only ever used to ask whether a published time was computed rather than
     agreed, so low-precision formulae are the right size: a minute either way
     changes nothing about that question. Returns real dates, so the caller
     compares timestamps and never has to think about British Summer Time. */
  function julianDay(y,m,d){
    if(m<=2){ y-=1; m+=12; }
    var a=Math.floor(y/100), b=2-a+Math.floor(a/4);
    return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+b-1524.5;
  }
  function solarNoonUTC(dateStr,lng){
    var p=String(dateStr||'').split('-');
    if(p.length!==3) return null;
    var y=+p[0], mo=+p[1], d=+p[2];
    if(!(y&&mo&&d)) return null;
    var n=julianDay(y,mo,d)-2451545.0+0.5;
    var L=(280.460+0.9856474*n)%360, g=(357.528+0.9856003*n)%360*Math.PI/180;
    var lam=(L+1.915*Math.sin(g)+0.020*Math.sin(2*g))*Math.PI/180;
    var eps=(23.439-0.0000004*n)*Math.PI/180;
    var dec=Math.asin(Math.sin(eps)*Math.sin(lam));
    var ra=Math.atan2(Math.cos(eps)*Math.sin(lam),Math.cos(lam));
    var e=(L*Math.PI/180)-ra;
    e=((e+Math.PI)%(2*Math.PI))-Math.PI;
    var noonH=12-lng/15-(e*180/Math.PI*4)/60;
    return {dec:dec, at:new Date(Date.UTC(y,mo-1,d)+noonH*3600000)};
  }
  /* Asr is the one prayer with no clock time of its own: it arrives when a
     shadow reaches a multiple of the object's height. That is exactly why it
     is the tell. Both schools are tried, because either match means a machine
     produced the number. */
  function asrUTC(sun,lat,ratio){
    var la=lat*Math.PI/180;
    var A=Math.atan(1/(ratio+Math.tan(Math.abs(la-sun.dec))));
    var x=(Math.sin(A)-Math.sin(la)*Math.sin(sun.dec))/(Math.cos(la)*Math.cos(sun.dec));
    if(x<-1||x>1) return null;
    return new Date(sun.at.getTime()+(Math.acos(x)*180/Math.PI/15)*3600000);
  }
  function apartMinutes(a,b){ return Math.abs(a.getTime()-b.getTime())/60000; }

  /* ── A listing nobody ever agreed to ──────────────────────────────────
     judge() already refuses times generated from a formula, but only when the
     mosque publishes start times too: a constant gap between the two rows is
     what gives it away. With one row and nothing to hold it against, whatever
     arrives is taken as the congregation's decision.

     Redbridge Islamic Centre is what that costs. Their own page carries two
     rows, computed begins and the jama'ah their committee sets, and the
     directory took the begins. Bilal called people to isha at 21:10 for a
     jama'ah at 21:30. Finsbury Park is the same fault, 29 minutes early at
     fajr and 26 at asr.

     So ask the sun instead. A committee rounds dhuhr to the quarter hour; a
     formula leaves it a few minutes after the sun is highest and off any
     round number. Asr confirms it, because a number that lands on the shadow
     calculation to the minute was computed rather than agreed. Both must
     agree before anything is refused. Against 195 mosques whose times are
     known to be real this rejects none of them, and it catches both of the
     mosques we know are wrong. */
  function looksComputed(row,place){
    if(!row||!place) return false;
    var lat=typeof place.y==='number' ? place.y : place.lat;
    var lng=typeof place.x==='number' ? place.x : place.lng;
    if(typeof lat!=='number'||typeof lng!=='number') return false;
    var dhuhr=row.jamaah && row.jamaah.dhuhr, asr=row.jamaah && row.jamaah.asr;
    if(!validDate(dhuhr)||!validDate(asr)) return false;
    if(wallMinutes(dhuhr)%5===0) return false;
    var sun=solarNoonUTC(row.date,lng);
    if(!sun) return false;
    if(apartMinutes(dhuhr,sun.at)>12) return false;
    var a1=asrUTC(sun,lat,1), a2=asrUTC(sun,lat,2);
    var near1=a1 && apartMinutes(asr,a1)<=3, near2=a2 && apartMinutes(asr,a2)<=3;
    return !!(near1||near2);
  }

  function verdict(use,kind,why,audit){
    return {use:use,kind:kind,why:why,audit:audit};
  }

  function judge(rows,now,place){
    var audit=auditRows(rows), today=dateKey(now), row=null, i;
    for(i=0;i<(rows||[]).length;i++) if(rows[i].date===today){ row=rows[i]; break; }
    if(!row){
      for(i=0;i<(rows||[]).length;i++) if(rows[i].date>today){ row=rows[i]; break; }
      if(!row) row=(rows||[])[0]||null;
    }
    if(!row) return verdict(false,'bad','No jama\'ah times published',audit);

    var nq=0, offs=[];
    PRAYERS.forEach(function(prayer){
      var key=rowKey(row,prayer), begins=row.begins && row.begins[prayer];
      var jamaah=row.jamaah && row.jamaah[prayer];
      if(validDate(jamaah) && !audit.bad[key]) nq++;
      if(validDate(begins) && validDate(jamaah) && !audit.bad[key]){
        offs.push(Math.round(offsetMinutes(begins,jamaah)));
      }
    });
    var distinct={}; offs.forEach(function(n){ distinct[n]=1; });
    var n=Object.keys(distinct).length;

    if(nq===0) return verdict(false,'bad','No trustworthy jama\'ah times published',audit);
    if(nq<3) return verdict(false,'warn','Only a partial listing passed its checks',audit);
    if(row.date!==today) return verdict(true,'warn','No times published for today',audit);
    if(audit.issues.length) return verdict(true,'warn','Some times withheld for checking',audit);
    if(offs.length===0 && looksComputed(row,place))
      return verdict(false,'bad','Times look automatic, not set by the mosque',audit);
    if(offs.length===0) return verdict(true,'warn','Jama\'ah times, but no separate start times',audit);
    if(n===1) return verdict(false,'bad','Times look automatic, not set by the mosque',audit);
    if(n===2) return verdict(true,'warn','Times not confirmed by the mosque',audit);
    return verdict(true,'ok','Real jama\'ah times, set by the mosque',audit);
  }

  /* Results are ordered nearest-first. A usable result is only decisive once
     every closer result has settled; a fast mosque farther away must never
     jump one whose timetable is still being checked. */
  function firstDecidable(results){
    for(var i=0;i<(results||[]).length;i++){
      if(typeof results[i]==='undefined') return {decided:false,index:-1,result:null};
      if(results[i] && results[i].v && results[i].v.use){
        return {decided:true,index:i,result:results[i]};
      }
    }
    return {decided:true,index:-1,result:null};
  }

  /* A pull only belongs to a deliberate, mostly vertical drag from the very
     top of the page. Keeping the geometry here makes the gesture testable and
     stops ordinary sideways swipes or in-page scrolling becoming reloads. */
  function pullDistance(dy,dx,atTop,resistance,maximum){
    if(!atTop || dy<=0 || Math.abs(dx)>dy*.8) return 0;
    return Math.min(maximum,dy*resistance);
  }

  /* A directory coordinate is safer than asking Maps to guess which branch a
     generic mosque name means. Only a human-reviewed identity may use the nicer
     named-establishment handoff; a Place ID remains the strongest form. */
  function mapsUrl(m){
    var reviewed=!!(m && (m.v===1 || m.placeId));
    var identity='';
    if(reviewed){
      identity=[m.n,m.a].filter(function(value){
        return String(value||'').trim();
      }).join(', ');
    }
    if(!identity && m && m.y!=null && m.x!=null &&
       isFinite(Number(m.y)) && isFinite(Number(m.x))){
      identity=Number(m.y).toFixed(6)+','+Number(m.x).toFixed(6);
    }
    if(!identity && m) identity=[m.n,m.a].filter(Boolean).join(', ');
    var url='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(identity);
    if(m && m.placeId) url+='&destination_place_id='+encodeURIComponent(m.placeId);
    return url;
  }

  return {PRAYERS:PRAYERS,effectiveJamaah:effectiveJamaah,auditRows:auditRows,
    nextJamaah:nextJamaah,lastJamaah:lastJamaah,salahPhase:salahPhase,
    currentAtmosphere:currentAtmosphere,solarNoonUTC:solarNoonUTC,
    judge:judge,looksComputed:looksComputed,firstDecidable:firstDecidable,
    pullDistance:pullDistance,mapsUrl:mapsUrl};
});
