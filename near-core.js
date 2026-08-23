(function(root,factory){
  var api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.BilalNearCore=api;
})(typeof self!=='undefined' ? self : this,function(){
  'use strict';

  var PRAYERS=['fajr','dhuhr','asr','maghrib','isha'];

  function validDate(d){ return d instanceof Date && !isNaN(d.getTime()); }
  function pad(n){ return n<10 ? '0'+n : String(n); }
  function dateKey(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function rowKey(row,prayer){ return String(row.date||'')+'/'+prayer; }
  function wallMinutes(d){ return d.getHours()*60+d.getMinutes(); }

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
    var hour=now.getHours();
    if(hour<5) return 'isha';
    if(hour<8) return 'fajr';
    if(hour<15) return 'dhuhr';
    if(hour<19) return 'asr';
    if(hour<21) return 'maghrib';
    return 'isha';
  }

  function verdict(use,kind,why,audit){
    return {use:use,kind:kind,why:why,audit:audit};
  }

  function judge(rows,now){
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
    nextJamaah:nextJamaah,currentAtmosphere:currentAtmosphere,
    judge:judge,firstDecidable:firstDecidable,
    pullDistance:pullDistance,mapsUrl:mapsUrl};
});
